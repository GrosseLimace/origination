using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads tickets live from CTRM - by producer or by contract - with a short shared cache.
/// </summary>
/// <remarks>
/// <para><b>Why this still needs date windows when contracts do not.</b> <c>tickets</c> accepts
/// <c>customerId</c> and <c>contractNumbers</c>, but unlike <c>contracts</c> it will not waive the date
/// range for either, and the range is capped at <see cref="CtrmQueries.MaxTicketRangeDays"/>. That is
/// structural rather than arbitrary: the ticket header carries neither a customer nor a contract - both
/// live on the detail rows - so each filter is an EXISTS semi-join and the range is what keeps the header
/// scan bounded. A longer lookback is therefore sliced into consecutive windows.</para>
///
/// <para>Slices run concurrently, so a multi-window lookback costs about the slowest window rather than
/// the sum. Measured against QA a single window is ~1.0-1.3s warm and up to ~5.5s cold, so the
/// three-year default costs about one window rather than three.</para>
///
/// <para>Cache semantics match <see cref="CtrmContractReader"/>: short TTL, shared in-flight task,
/// failures never cached. The producer screen asks for the full ticket list and the unapplied subset,
/// so coalescing turns two reads into one.</para>
/// </remarks>
public sealed class CtrmTicketReader
{
    private const int PageSize = 500;

    /// <summary>Per-window page cap. A single producer exceeding this in one window would mean the
    /// filter is not applying.</summary>
    private const int MaxPagesPerWindow = 10;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmTicketReader> _logger;

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);

    private sealed record CacheEntry(DateTime CreatedUtc, Task<CtrmReadResult<List<CtrmTicketDto>>> Read);

    /// <summary>Which server-side filter a read is using, for cache keys, variables and log lines.</summary>
    private sealed record Scope(string CacheKey, string Description, string Document, object Filter);

    public CtrmTicketReader(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmTicketReader> logger)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// This producer's tickets across the configured lookback, newest window first.
    /// </summary>
    /// <remarks>
    /// The lookback defaults to three years, matching the ODS cutoff. Each additional 366 days is one more
    /// parallel window and roughly another second, so widen <c>Ctrm:TicketLookbackDays</c> deliberately.
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducerAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim() ?? string.Empty;
        if (code.Length == 0) return Failed("No producer code supplied.");

        return GetCachedAsync(new Scope(
            CacheKey: $"customer:{code}",
            Description: $"producer {code}",
            Document: CtrmQueries.TicketsByCustomer,
            Filter: new { customerId = code }));
    }

    /// <summary>
    /// Every ticket applied to the given contract numbers, whichever producer each is booked under.
    /// </summary>
    /// <remarks>
    /// <para>Scoped on the contract rather than the producer, which is the only way to see a split load -
    /// a ticket against one of these contracts booked under a different customer code. Contract numbers
    /// are sorted into the cache key so callers that build the same set in a different order share a read.</para>
    ///
    /// <para>Bounded by the same lookback as the producer read, because the date range is mandatory here
    /// too. A caller needing tickets older than the lookback has to widen it for both.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForContractsAsync(
        IReadOnlyCollection<string> contractNumbers, CancellationToken cancellationToken)
    {
        var numbers = (contractNumbers ?? [])
            .Select(n => n?.Trim())
            .Where(n => !string.IsNullOrEmpty(n))
            .Select(n => n!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // An empty set is a legitimate question with an empty answer - a producer with no open contracts
        // has no applied tickets - so it must never become an unfiltered query.
        if (numbers.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = CtrmReadStatus.Ok,
                Value = []
            });

        return GetCachedAsync(new Scope(
            CacheKey: $"contracts:{string.Join(',', numbers)}",
            Description: numbers.Count == 1 ? $"contract {numbers[0]}" : $"{numbers.Count} contracts",
            Document: CtrmQueries.TicketsByContractNumbers,
            Filter: new { contractNumbers = numbers }));
    }

    /// <summary>
    /// Tickets for a batch of producers over a single bill-of-lading window.
    /// </summary>
    /// <remarks>
    /// <para>Backs the recent-unapplied read behind Spot Loads. Deliberately ONE window rather than the
    /// sliced lookback the per-producer read uses: the cost of a ticket query is the header scan, not the
    /// rows, so a 30-day question costs about the same few seconds as a one-day one - measured 6.1s for 76
    /// rows across 88 producers - while three years of it is roughly a thousand pages.</para>
    ///
    /// <para>Chunked to the <c>customerIds</c> cap. Chunks run concurrently; each is a single page in
    /// practice, and the page cap still applies if a window turns out to be busier than expected.</para>
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducersAsync(
        IReadOnlyCollection<string> scoularIds, DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        var codes = CtrmCustomerCodes.Normalize(scoularIds, out var dropped);

        if (dropped.Count > 0)
            _logger.LogWarning(
                "CTRM tickets: dropped {Count} producer code(s) longer than {Max} characters before querying. " +
                "The customerIds filter answers an internal error rather than an empty match for those, and " +
                "would fail every producer in the same chunk. Codes: {Codes}",
                dropped.Count, CtrmCustomerCodes.MaxLength, string.Join(", ", dropped.Take(10)));

        // An empty set must never become an unfiltered query - that would scan the window for every
        // counterparty in the library rather than returning nothing.
        if (codes.Count == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = [] });

        var span = (to.Date - from.Date).TotalDays;
        if (span > CtrmQueries.MaxTicketRangeDays)
            return Failed($"A bill-of-lading range of {span:F0} days exceeds the server's "
                        + $"{CtrmQueries.MaxTicketRangeDays}-day cap; narrow the window or slice it.");

        var key = $"producers:{from:yyyy-MM-dd}:{to:yyyy-MM-dd}:{codes.Count}:{StableHash(codes)}";
        return GetCachedAsync(key, () => FetchChunkedAsync(codes, from, to));
    }

    /// <summary>Drops a producer's cached read.</summary>
    public void Invalidate(string scoularId)
        => _cache.TryRemove($"customer:{scoularId?.Trim() ?? string.Empty}", out _);

    /// <summary>
    /// Order-independent hash of a producer set, for use in a cache key.
    /// </summary>
    /// <remarks>
    /// FNV-1a over the sorted, upper-cased codes. The count is kept in the key beside it as a cheap guard,
    /// because a collision would serve one trade unit's tickets to another.
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

    // -------------------------------------------------------------------------

    private static Task<CtrmReadResult<List<CtrmTicketDto>>> Failed(string detail)
        => Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = CtrmReadStatus.Error,
            Detail = detail,
            Value = []
        });

    private Task<CtrmReadResult<List<CtrmTicketDto>>> GetCachedAsync(Scope scope)
        => GetCachedAsync(scope.CacheKey, () => FetchAsync(scope));

    private Task<CtrmReadResult<List<CtrmTicketDto>>> GetCachedAsync(
        string cacheKey, Func<Task<CtrmReadResult<List<CtrmTicketDto>>>> fetch)
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

            // Another caller won the race; loop and take theirs.
        }
    }

    /// <summary>
    /// Fetches one window for a chunked producer set, all chunks concurrently.
    /// </summary>
    /// <remarks>
    /// No window slicing here, unlike <see cref="FetchAsync"/>: the caller has already chosen a range
    /// inside the server's cap, because the point of this read is that a narrow window is cheap.
    /// </remarks>
    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchChunkedAsync(
        List<string> codes, DateTime from, DateTime to)
    {
        var chunks = codes.Chunk(CtrmCustomerCodes.MaxPerCall).ToList();
        var concurrency = Math.Clamp(ReadInt("Ctrm:PageConcurrency", 4), 1, 8);
        using var slot = new SemaphoreSlim(concurrency, concurrency);

        var results = await Task.WhenAll(chunks.Select(async chunk =>
        {
            await slot.WaitAsync(CancellationToken.None);
            try
            {
                return await FetchWindowAsync(
                    new Scope(
                        CacheKey: string.Empty,
                        Description: $"{chunk.Length} producer(s)",
                        Document: CtrmQueries.TicketsByCustomers,
                        Filter: new { customerIds = chunk }),
                    from, to);
            }
            finally
            {
                slot.Release();
            }
        }));

        // Any chunk failing makes the answer incomplete, and a short list here reads as "no spot loads"
        // rather than as a failure.
        var failure = results.FirstOrDefault(r => !r.Ok);
        if (failure is not null) return failure;

        var all = results.SelectMany(r => r.Value ?? []).ToList();

        _logger.LogInformation(
            "CTRM live tickets: {Count} tickets for {Producers} producer(s) over {From:yyyy-MM-dd}..{To:yyyy-MM-dd} " +
            "in {Chunks} chunk(s).",
            all.Count, codes.Count, from, to, chunks.Count);

        return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };
    }

    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchAsync(Scope scope)
    {
        var lookbackDays = Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095));
        var windows = BuildWindows(DateTime.Today, lookbackDays);

        var results = await Task.WhenAll(windows.Select(w => FetchWindowAsync(scope, w.From, w.To)));

        // Any window failing makes the whole answer incomplete. Reporting the first failure rather than
        // silently returning a partial list keeps an outage from looking like a producer with no tickets.
        var failure = results.FirstOrDefault(r => !r.Ok);
        if (failure is not null)
            return new CtrmReadResult<List<CtrmTicketDto>>
            {
                Status = failure.Status,
                HttpStatus = failure.HttpStatus,
                ErrorCode = failure.ErrorCode,
                Detail = failure.Detail,
                Value = []
            };

        var all = results.SelectMany(r => r.Value ?? []).ToList();

        _logger.LogInformation(
            "CTRM live tickets: {Count} tickets for {Scope} across {Windows} window(s) ({Days}-day lookback).",
            all.Count, scope.Description, windows.Count, lookbackDays);

        return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };
    }

    /// <summary>
    /// Splits a lookback into consecutive windows no wider than the server's cap, newest first.
    /// </summary>
    /// <remarks>
    /// Windows are inclusive on both ends, so each one starts the day after the previous ends - otherwise
    /// a ticket on a boundary date would be fetched twice and appear duplicated on screen.
    /// </remarks>
    public static List<(DateTime From, DateTime To)> BuildWindows(DateTime today, int lookbackDays)
    {
        var max = CtrmQueries.MaxTicketRangeDays;
        var windows = new List<(DateTime, DateTime)>();

        // Reach one day into the future so a ticket dated today is never missed to a clock/timezone skew
        // between us and the Db2 host.
        var to = today.AddDays(1);
        var earliest = today.AddDays(-lookbackDays);

        while (to > earliest)
        {
            var from = to.AddDays(-max);
            if (from < earliest) from = earliest;
            windows.Add((from, to));
            to = from.AddDays(-1);
        }

        return windows;
    }

    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchWindowAsync(Scope scope, DateTime from, DateTime to)
    {
        var all = new List<CtrmTicketDto>();
        var skip = 0;

        for (var page = 0; page < MaxPagesPerWindow; page++)
        {
            var result = await _client.QueryAsync<CtrmTicketsResponse>(
                scope.Document,
                BuildVariables(scope.Filter, from, to, skip),
                // Deliberately not the caller's token: concurrent callers share this read, so one
                // navigating away must not cancel the work the others are awaiting.
                CancellationToken.None);

            if (!result.Ok)
                return new CtrmReadResult<List<CtrmTicketDto>>
                {
                    Status = result.Status,
                    HttpStatus = result.HttpStatus,
                    ErrorCode = result.ErrorCode,
                    Detail = $"Live ticket read failed for {scope.Description} "
                           + $"({from:yyyy-MM-dd}..{to:yyyy-MM-dd}): {result.Detail}",
                    Value = []
                };

            var pageData = result.Value?.Tickets;
            if (pageData is null)
                return new CtrmReadResult<List<CtrmTicketDto>>
                {
                    Status = CtrmReadStatus.Error,
                    HttpStatus = result.HttpStatus,
                    Detail = $"CTRM returned no tickets object for {scope.Description}.",
                    Value = []
                };

            all.AddRange(pageData.Items);

            if (pageData.PageInfo?.HasNextPage != true)
                return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };

            skip += PageSize;
        }

        _logger.LogError(
            "CTRM live tickets TRUNCATED [{ErrorCode}] [{ErrorCategory}]: {Scope} window " +
            "{From:yyyy-MM-dd}..{To:yyyy-MM-dd} still had more after {MaxPages} pages ({Count} rows).",
            "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scope.Description, from, to, MaxPagesPerWindow, all.Count);

        return new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = CtrmReadStatus.PartialSuccess,
            Detail = $"Truncated after {MaxPagesPerWindow} pages in {from:yyyy-MM-dd}..{to:yyyy-MM-dd}.",
            Value = all
        };
    }

    /// <summary>
    /// Combines a scope's filter argument with the window and paging arguments every ticket query takes.
    /// </summary>
    /// <remarks>
    /// A dictionary rather than an anonymous type because the filter half differs per document
    /// (<c>customerId</c> vs <c>contractNumbers</c>), and the client serializes either shape identically.
    /// </remarks>
    private static Dictionary<string, object?> BuildVariables(object filter, DateTime from, DateTime to, int skip)
    {
        var variables = new Dictionary<string, object?>
        {
            ["from"] = from.ToString("yyyy-MM-dd"),
            ["to"] = to.ToString("yyyy-MM-dd"),
            ["skip"] = skip,
            ["take"] = PageSize
        };

        foreach (var property in filter.GetType().GetProperties())
            variables[property.Name] = property.GetValue(filter);

        return variables;
    }

    /// <summary>
    /// Reads an int setting, falling back when absent or unparseable.
    /// </summary>
    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
