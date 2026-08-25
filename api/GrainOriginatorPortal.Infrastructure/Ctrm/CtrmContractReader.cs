using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads contracts live from CTRM - one producer, or a batch of producers for one crop year.
/// </summary>
/// <remarks>
/// <para><b>Why this replaces the window snapshot for per-producer reads.</b> The <c>contracts</c> field
/// accepts <c>customerId</c>, and supplying it waives the otherwise-mandatory date range - so a
/// producer's FULL contract history comes back in one query. No window, no warm-up, no truncation, and
/// no 12-hour staleness. Measured warm: 1.4-2.0s including pricing lines.</para>
///
/// <para><b>Why there is still a cache.</b> Selecting a producer triggers three reads that all want the
/// same rows - the contract list, the pricing lines, and the pacing card. Without a cache that is three
/// round trips of identical work; with one it is a single call. The TTL is deliberately short (seconds,
/// not hours) so this stays a request-coalescing device rather than a staleness source: the thing the
/// snapshot got wrong was caching for long enough to be wrong.</para>
///
/// <para><b>Why the in-flight task is shared.</b> Those three reads arrive near-simultaneously, so
/// caching only completed results would still let all three fire. The cache therefore stores the
/// <see cref="Task{TResult}"/> itself, and late arrivals await the call already in progress.</para>
/// </remarks>
public sealed class CtrmContractReader
{
    /// <summary>Page size. 500 is the API's ceiling; a producer almost never exceeds one page.</summary>
    private const int PageSize = 500;

    /// <summary>Safety stop for a single-producer read. More contracts than this for one producer would
    /// mean the filter is not doing what we think, so bail loudly rather than page forever.</summary>
    private const int MaxPages = 20;

    /// <summary>Server-enforced ceiling on the <c>customerIds</c> list.</summary>
    private const int MaxCustomerIdsPerCall = 500;

    /// <summary>Per-chunk page cap for a batch read. A crop year for 500 producers ran to a handful of
    /// pages in measurement; this is headroom, not a target.</summary>
    private const int MaxPagesPerChunk = 40;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmContractReader> _logger;

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);

    private sealed record CacheEntry(DateTime CreatedUtc, Task<CtrmReadResult<List<CtrmContractDto>>> Read);

    public CtrmContractReader(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmContractReader> logger)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Every purchase contract CTRM holds for this producer, any date.
    /// </summary>
    /// <remarks>
    /// Concurrent callers for the same producer share one request. The supplied
    /// <paramref name="cancellationToken"/> is deliberately NOT threaded into the shared fetch: one
    /// caller navigating away would otherwise cancel the work the other two are waiting on.
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmContractDto>>> GetForProducerAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        if (code.Length == 0) return Failed("No producer code supplied.");

        return GetCachedAsync($"customer:{code}", () => FetchForProducerAsync(code));
    }

    /// <summary>
    /// Purchase contracts for a batch of producers in one crop year.
    /// </summary>
    /// <remarks>
    /// <para>Backs the crop-year contract list, which was delegated to ODS while <c>cropYear</c> was
    /// readable but not filterable. Uses <c>customerIds</c>, whose plural form waives the date range the
    /// same way the singular does, so this is a whole crop year rather than a window.</para>
    ///
    /// <para><c>customerIds</c> is capped at <see cref="MaxCustomerIdsPerCall"/>, so the producer set is
    /// chunked and the chunks run at the configured page concurrency. Cost is roughly flat per chunk
    /// regardless of how many codes it carries, so fuller chunks are strictly cheaper.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmContractDto>>> GetForCropYearAsync(
        IReadOnlyCollection<string> scoularIds, int cropYear, CancellationToken cancellationToken)
    {
        var codes = Normalize(scoularIds);

        // An empty producer set is a legitimate question with an empty answer. It must never become an
        // unfiltered query - without customerIds the server would demand a date range and, given one,
        // would return every counterparty in the library.
        if (codes.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmContractDto>> { Status = CtrmReadStatus.Ok, Value = [] });

        // Hashed rather than joined: the key would otherwise be tens of kilobytes for a full trade unit.
        var key = $"cropyear:{cropYear}:{codes.Count}:{StableHash(codes)}";
        return GetCachedAsync(key, () => FetchForCropYearAsync(codes, cropYear));
    }

    /// <summary>Drops a producer's cached read, so the next request goes back to CTRM.</summary>
    public void Invalidate(string scoularId)
        => _cache.TryRemove($"customer:{scoularId?.Trim() ?? string.Empty}", out _);

    // -------------------------------------------------------------------------

    private List<string> Normalize(IReadOnlyCollection<string>? codes)
    {
        var cleaned = CtrmCustomerCodes.Normalize(codes, out var dropped);

        // A warning, not silence: the producer really is missing from the result. Dropping beats sending,
        // because sending loses the whole chunk instead of one row.
        if (dropped.Count > 0)
            _logger.LogWarning(
                "CTRM contracts: dropped {Count} producer code(s) longer than {Max} characters before querying. " +
                "The customerIds filter answers an internal error rather than an empty match for those, and " +
                "would fail every producer in the same chunk. Codes: {Codes}",
                dropped.Count, CtrmCustomerCodes.MaxLength, string.Join(", ", dropped.Take(10)));

        return cleaned;
    }

    /// <summary>
    /// Order-independent hash of a producer set, for use in a cache key.
    /// </summary>
    /// <remarks>
    /// FNV-1a over the sorted, upper-cased codes. Not security-relevant - a collision would serve one
    /// trade unit's contracts to another, so the count is kept in the key alongside it as a cheap guard.
    /// <see cref="string.GetHashCode()"/> is deliberately avoided: it is randomized per process, which
    /// would be fine here but is a trap for anyone who later persists the key.
    /// </remarks>
    private static string StableHash(IEnumerable<string> codes)
    {
        var hash = 2166136261u;
        foreach (var code in codes)
        {
            foreach (var c in code.ToUpperInvariant())
            {
                hash ^= c;
                hash *= 16777619u;
            }
            hash ^= (byte)',';
            hash *= 16777619u;
        }
        return hash.ToString("x8", CultureInfo.InvariantCulture);
    }

    private static Task<CtrmReadResult<List<CtrmContractDto>>> Failed(string detail)
        => Task.FromResult(new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = CtrmReadStatus.Error,
            Detail = detail,
            Value = []
        });

    private Task<CtrmReadResult<List<CtrmContractDto>>> GetCachedAsync(
        string cacheKey, Func<Task<CtrmReadResult<List<CtrmContractDto>>>> fetch)
    {
        var ttl = TimeSpan.FromSeconds(Math.Max(0, ReadInt("Ctrm:LiveCacheSeconds", 60)));

        while (true)
        {
            if (_cache.TryGetValue(cacheKey, out var existing))
            {
                // Reuse while fresh, and never keep a failed read: a transient error should not lock a
                // producer out of the screen until the TTL happens to expire.
                var failed = existing.Read.IsCompleted
                             && (!existing.Read.IsCompletedSuccessfully || !existing.Read.Result.Ok);

                if (!failed && DateTime.UtcNow - existing.CreatedUtc < ttl)
                    return existing.Read;

                _cache.TryRemove(cacheKey, out _);
            }

            var entry = new CacheEntry(DateTime.UtcNow, fetch());
            if (_cache.TryAdd(cacheKey, entry))
                return entry.Read;

            // Another thread won the race; loop and take theirs.
        }
    }

    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchForProducerAsync(string scoularId)
    {
        var all = new List<CtrmContractDto>();
        var skip = 0;

        for (var page = 0; page < MaxPages; page++)
        {
            var result = await _client.QueryAsync<CtrmContractsResponse>(
                CtrmQueries.ContractsByCustomer,
                new
                {
                    customerId = scoularId,
                    prefix = CtrmMappings.PurchasePrefix,
                    skip,
                    take = PageSize
                },
                CancellationToken.None);

            if (!result.Ok)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = result.Status,
                    HttpStatus = result.HttpStatus,
                    ErrorCode = result.ErrorCode,
                    Detail = $"Live contract read failed for producer {scoularId}: {result.Detail}",
                    Value = []
                };

            var pageData = result.Value?.Contracts;
            if (pageData is null)
                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = CtrmReadStatus.Error,
                    HttpStatus = result.HttpStatus,
                    Detail = $"CTRM returned no contracts object for producer {scoularId}.",
                    Value = []
                };

            all.AddRange(pageData.Items);

            if (pageData.PageInfo?.HasNextPage != true)
            {
                _logger.LogInformation(
                    "CTRM live contracts: {Count} purchase contracts for producer {ScoularId} (all dates, {Pages} page(s)).",
                    all.Count, scoularId, page + 1);

                return new CtrmReadResult<List<CtrmContractDto>>
                {
                    Status = CtrmReadStatus.Ok,
                    HttpStatus = result.HttpStatus,
                    Value = all
                };
            }

            skip += PageSize;
        }

        // Reaching the cap means the server-side customer filter is not narrowing as expected. Loud,
        // because the alternative is a producer silently showing a truncated contract list.
        _logger.LogError(
            "CTRM live contracts TRUNCATED [{ErrorCode}] [{ErrorCategory}]: producer {ScoularId} still had more " +
            "after {MaxPages} pages ({Count} rows). The customerId filter may not be applying.",
            "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scoularId, MaxPages, all.Count);

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = CtrmReadStatus.PartialSuccess,
            Detail = $"Truncated after {MaxPages} pages ({all.Count} contracts) for producer {scoularId}.",
            Value = all
        };
    }

    /// <summary>
    /// Fans a crop-year read out across producer chunks and pages, all through one concurrency budget.
    /// </summary>
    /// <remarks>
    /// <para>Two phases, for a reason worth stating. Each chunk's first page is fetched to learn its
    /// <c>totalCount</c>; only then is the page count known, which frees every remaining page across every
    /// chunk to run together. Paging sequentially within a chunk instead measured ~8s per 500-row page and
    /// four pages for a single 88-producer chunk - about 32s of mostly idle waiting.</para>
    ///
    /// <para>One shared semaphore covers chunks and pages alike, so the ceiling is a true request ceiling
    /// rather than per-chunk. A 429 from APIM fails the whole read, so headroom matters more than the last
    /// few seconds.</para>
    /// </remarks>
    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchForCropYearAsync(List<string> codes, int cropYear)
    {
        var chunks = codes.Chunk(MaxCustomerIdsPerCall).ToList();
        var concurrency = Math.Clamp(ReadInt("Ctrm:PageConcurrency", 4), 1, 8);
        using var slot = new SemaphoreSlim(concurrency, concurrency);

        async Task<CtrmReadResult<CtrmPage<CtrmContractDto>>> Fetch(string[] chunk, int skip)
        {
            await slot.WaitAsync(CancellationToken.None);
            try
            {
                return await FetchCropYearPageAsync(chunk, cropYear, skip);
            }
            finally
            {
                slot.Release();
            }
        }

        var firstPages = await Task.WhenAll(chunks.Select(chunk => Fetch(chunk, 0)));

        var failure = firstPages.FirstOrDefault(p => !p.Ok);
        if (failure is not null) return Propagate(failure, cropYear);

        var pages = new List<CtrmPage<CtrmContractDto>>();
        var rest = new List<Task<CtrmReadResult<CtrmPage<CtrmContractDto>>>>();
        var truncated = false;

        for (var i = 0; i < chunks.Count; i++)
        {
            var page = firstPages[i].Value!;
            pages.Add(page);

            // hasNextPage is authoritative for "is there more", NOT the totalCount arithmetic. The two can
            // disagree - a first page can return every row while totalCount counts something broader - and
            // trusting the arithmetic alone would request a page the server says does not exist.
            if (page.PageInfo?.HasNextPage != true) continue;

            var pagesAvailable = (int)Math.Ceiling(page.TotalCount / (double)PageSize);
            var pagesToFetch = Math.Min(Math.Max(pagesAvailable, 2), MaxPagesPerChunk);
            if (pagesAvailable > MaxPagesPerChunk) truncated = true;

            for (var p = 1; p < pagesToFetch; p++)
                rest.Add(Fetch(chunks[i], p * PageSize));
        }

        if (rest.Count > 0)
        {
            var restPages = await Task.WhenAll(rest);

            failure = restPages.FirstOrDefault(p => !p.Ok);
            if (failure is not null) return Propagate(failure, cropYear);

            pages.AddRange(restPages.Select(p => p.Value!));
        }

        var all = pages.SelectMany(p => p.Items).ToList();

        if (truncated)
            _logger.LogError(
                "CTRM crop-year contracts TRUNCATED [{ErrorCode}] [{ErrorCategory}]: crop year {CropYear} " +
                "needed more than {MaxPages} pages in at least one chunk ({Count} rows kept).",
                "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", cropYear, MaxPagesPerChunk, all.Count);
        else
            _logger.LogInformation(
                "CTRM live contracts: {Count} purchase contracts for crop year {CropYear} across " +
                "{Producers} producer(s), {Chunks} chunk(s), {Pages} page(s).",
                all.Count, cropYear, codes.Count, chunks.Count, pages.Count);

        return new CtrmReadResult<List<CtrmContractDto>>
        {
            Status = truncated ? CtrmReadStatus.PartialSuccess : CtrmReadStatus.Ok,
            Detail = truncated ? $"Truncated at {MaxPagesPerChunk} pages per chunk for crop year {cropYear}." : null,
            Value = all
        };
    }

    private static CtrmReadResult<List<CtrmContractDto>> Propagate(
        CtrmReadResult<CtrmPage<CtrmContractDto>> failure, int cropYear) => new()
        {
            Status = failure.Status,
            HttpStatus = failure.HttpStatus,
            ErrorCode = failure.ErrorCode,
            Detail = $"Crop-year contract read failed for crop year {cropYear}: {failure.Detail}",
            Value = []
        };

    private async Task<CtrmReadResult<CtrmPage<CtrmContractDto>>> FetchCropYearPageAsync(
        string[] chunk, int cropYear, int skip)
    {
        var result = await _client.QueryAsync<CtrmContractsResponse>(
            CtrmQueries.ContractsByCustomersAndCropYear,
            new
            {
                customerIds = chunk,
                prefix = CtrmMappings.PurchasePrefix,
                cropYear,
                skip,
                take = PageSize
            },
            CancellationToken.None);

        if (!result.Ok)
            return new CtrmReadResult<CtrmPage<CtrmContractDto>>
            {
                Status = result.Status,
                HttpStatus = result.HttpStatus,
                ErrorCode = result.ErrorCode,
                Detail = result.Detail
            };

        var page = result.Value?.Contracts;
        if (page is null)
            return new CtrmReadResult<CtrmPage<CtrmContractDto>>
            {
                Status = CtrmReadStatus.Error,
                HttpStatus = result.HttpStatus,
                Detail = $"CTRM returned no contracts object for crop year {cropYear}."
            };

        return new CtrmReadResult<CtrmPage<CtrmContractDto>>
        {
            Status = CtrmReadStatus.Ok,
            HttpStatus = result.HttpStatus,
            Value = page
        };
    }

    /// <summary>
    /// Reads an int setting, falling back when absent or unparseable.
    /// </summary>
    /// <remarks>
    /// Uses the indexer rather than <c>GetValue&lt;int&gt;</c> because that extension lives in
    /// Microsoft.Extensions.Configuration.Binder, which this project does not reference.
    /// </remarks>
    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
