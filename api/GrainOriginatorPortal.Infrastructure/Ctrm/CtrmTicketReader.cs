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

    /// <summary>Drops a producer's cached read.</summary>
    public void Invalidate(string scoularId)
        => _cache.TryRemove($"customer:{scoularId?.Trim() ?? string.Empty}", out _);

    // -------------------------------------------------------------------------

    private static Task<CtrmReadResult<List<CtrmTicketDto>>> Failed(string detail)
        => Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = CtrmReadStatus.Error,
            Detail = detail,
            Value = []
        });

    private Task<CtrmReadResult<List<CtrmTicketDto>>> GetCachedAsync(Scope scope)
    {
        var ttl = TimeSpan.FromSeconds(Math.Max(0, ReadInt("Ctrm:LiveCacheSeconds", 60)));

        while (true)
        {
            if (_cache.TryGetValue(scope.CacheKey, out var existing))
            {
                // Reuse while fresh, and never keep a failed read: a transient error should not lock a
                // producer out of the screen until the TTL happens to expire.
                var failed = existing.Read.IsCompleted
                             && (!existing.Read.IsCompletedSuccessfully || !existing.Read.Result.Ok);

                if (!failed && DateTime.UtcNow - existing.CreatedUtc < ttl)
                    return existing.Read;

                _cache.TryRemove(scope.CacheKey, out _);
            }

            var entry = new CacheEntry(DateTime.UtcNow, FetchAsync(scope));
            if (_cache.TryAdd(scope.CacheKey, entry))
                return entry.Read;

            // Another caller won the race; loop and take theirs.
        }
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
