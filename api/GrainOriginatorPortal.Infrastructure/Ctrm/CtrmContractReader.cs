using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads one producer's contracts live from CTRM, with a short shared cache.
/// </summary>
/// <remarks>
/// <para><b>Why this replaces the window snapshot for per-producer reads.</b> The <c>contracts</c> field
/// now accepts <c>customerId</c>, and supplying it waives the otherwise-mandatory date range — so a
/// producer's FULL contract history comes back in one query. No window, no warm-up, no truncation, and
/// no 12-hour staleness. Measured warm: 1.4-2.0s including pricing lines.</para>
///
/// <para><b>Why there is still a cache.</b> Selecting a producer triggers three reads that all want the
/// same rows — the contract list, the pricing lines, and the pacing card. Without a cache that is three
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

    /// <summary>Safety stop. A single producer having more than this many contracts would mean the
    /// filter is not doing what we think, so bail loudly rather than page forever.</summary>
    private const int MaxPages = 20;

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
        var key = scoularId?.Trim() ?? string.Empty;
        if (key.Length == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmContractDto>>
            {
                Status = CtrmReadStatus.Error,
                Detail = "No producer code supplied.",
                Value = []
            });

        var ttl = TimeSpan.FromSeconds(Math.Max(0, ReadInt("Ctrm:LiveCacheSeconds", 60)));

        while (true)
        {
            if (_cache.TryGetValue(key, out var existing))
            {
                // Reuse while fresh, and never keep a failed read: a transient error should not lock a
                // producer out of the screen until the TTL happens to expire.
                var failed = existing.Read.IsCompleted
                             && (!existing.Read.IsCompletedSuccessfully || !existing.Read.Result.Ok);

                if (!failed && DateTime.UtcNow - existing.CreatedUtc < ttl)
                    return existing.Read;

                _cache.TryRemove(key, out _);
            }

            var entry = new CacheEntry(DateTime.UtcNow, FetchAsync(key));
            if (_cache.TryAdd(key, entry))
                return entry.Read;

            // Another thread won the race; loop and take theirs.
        }
    }

    /// <summary>Drops a producer's cached read, so the next request goes back to CTRM.</summary>
    public void Invalidate(string scoularId) => _cache.TryRemove(scoularId?.Trim() ?? string.Empty, out _);

    private async Task<CtrmReadResult<List<CtrmContractDto>>> FetchAsync(string scoularId)
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
