using System.Collections.Concurrent;
using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Reads one producer's tickets live from CTRM, with a short shared cache.
/// </summary>
/// <remarks>
/// <para><b>Why this still needs date windows when contracts do not.</b> <c>tickets</c> accepts
/// <c>customerId</c>, but unlike <c>contracts</c> it will not waive the date range, and the range is
/// capped at <see cref="CtrmQueries.MaxTicketRangeDays"/>. That is structural rather than arbitrary: the
/// ticket header carries no customer — the customer lives on the detail rows — so the filter is an
/// EXISTS semi-join and the range is what keeps the header scan bounded. A longer lookback is therefore
/// sliced into consecutive windows.</para>
///
/// <para>Slices run concurrently, so a multi-window lookback costs about the slowest window rather than
/// the sum. They are not equally priced: measured against QA the most recent year is ~0.3-0.8s while each
/// older year is ~0.8-2.6s, which is why the default lookback is deliberately narrow.</para>
///
/// <para>Cache semantics match <see cref="CtrmContractReader"/>: short TTL, shared in-flight task,
/// failures never cached. The producer screen asks for the full ticket list and the unapplied subset,
/// so coalescing turns two reads into one.</para>
/// </remarks>
public sealed class CtrmTicketReader
{
    private const int PageSize = 500;

    /// <summary>Per-window page cap. A single producer exceeding this in one window would mean the
    /// customer filter is not applying.</summary>
    private const int MaxPagesPerWindow = 10;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmTicketReader> _logger;

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);

    private sealed record CacheEntry(DateTime CreatedUtc, Task<CtrmReadResult<List<CtrmTicketDto>>> Read);

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
    /// The lookback defaults to ONE year, chosen from measurement rather than symmetry with ODS. ODS uses a
    /// three-year cutoff, and matching it cost 5.4s per producer: the older windows are far more expensive
    /// than the recent one because earlier-year ticket volume is enormous and the customer filter is an
    /// EXISTS semi-join, so the header range still gets scanned. One year measures ~0.3-0.8s. Widen via
    /// Ctrm:TicketLookbackDays when a producer needs older tickets - each extra 366 days is one more
    /// parallel window and roughly another second.
    /// </remarks>
    public Task<CtrmReadResult<List<CtrmTicketDto>>> GetForProducerAsync(
        string scoularId, CancellationToken cancellationToken)
    {
        var key = scoularId?.Trim() ?? string.Empty;
        if (key.Length == 0)
            return Task.FromResult(new CtrmReadResult<List<CtrmTicketDto>>
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
                var failed = existing.Read.IsCompleted
                             && (!existing.Read.IsCompletedSuccessfully || !existing.Read.Result.Ok);

                if (!failed && DateTime.UtcNow - existing.CreatedUtc < ttl)
                    return existing.Read;

                _cache.TryRemove(key, out _);
            }

            var entry = new CacheEntry(DateTime.UtcNow, FetchAsync(key));
            if (_cache.TryAdd(key, entry))
                return entry.Read;
        }
    }

    /// <summary>Drops a producer's cached read.</summary>
    public void Invalidate(string scoularId) => _cache.TryRemove(scoularId?.Trim() ?? string.Empty, out _);

    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchAsync(string scoularId)
    {
        var lookbackDays = Math.Max(1, ReadInt("Ctrm:TicketLookbackDays", 1095));
        var windows = BuildWindows(DateTime.Today, lookbackDays);

        var results = await Task.WhenAll(windows.Select(w => FetchWindowAsync(scoularId, w.From, w.To)));

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
            "CTRM live tickets: {Count} tickets for producer {ScoularId} across {Windows} window(s) ({Days}-day lookback).",
            all.Count, scoularId, windows.Count, lookbackDays);

        return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };
    }

    /// <summary>
    /// Splits a lookback into consecutive windows no wider than the server's cap, newest first.
    /// </summary>
    /// <remarks>
    /// Windows are inclusive on both ends, so each one starts the day after the previous ends — otherwise
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

    private async Task<CtrmReadResult<List<CtrmTicketDto>>> FetchWindowAsync(string scoularId, DateTime from, DateTime to)
    {
        var all = new List<CtrmTicketDto>();
        var skip = 0;

        for (var page = 0; page < MaxPagesPerWindow; page++)
        {
            var result = await _client.QueryAsync<CtrmTicketsResponse>(
                CtrmQueries.TicketsByCustomer,
                new
                {
                    customerId = scoularId,
                    from = from.ToString("yyyy-MM-dd"),
                    to = to.ToString("yyyy-MM-dd"),
                    skip,
                    take = PageSize
                },
                CancellationToken.None);

            if (!result.Ok)
                return new CtrmReadResult<List<CtrmTicketDto>>
                {
                    Status = result.Status,
                    HttpStatus = result.HttpStatus,
                    ErrorCode = result.ErrorCode,
                    Detail = $"Live ticket read failed for producer {scoularId} "
                           + $"({from:yyyy-MM-dd}..{to:yyyy-MM-dd}): {result.Detail}",
                    Value = []
                };

            var pageData = result.Value?.Tickets;
            if (pageData is null)
                return new CtrmReadResult<List<CtrmTicketDto>>
                {
                    Status = CtrmReadStatus.Error,
                    HttpStatus = result.HttpStatus,
                    Detail = $"CTRM returned no tickets object for producer {scoularId}.",
                    Value = []
                };

            all.AddRange(pageData.Items);

            if (pageData.PageInfo?.HasNextPage != true)
                return new CtrmReadResult<List<CtrmTicketDto>> { Status = CtrmReadStatus.Ok, Value = all };

            skip += PageSize;
        }

        _logger.LogError(
            "CTRM live tickets TRUNCATED [{ErrorCode}] [{ErrorCategory}]: producer {ScoularId} window " +
            "{From:yyyy-MM-dd}..{To:yyyy-MM-dd} still had more after {MaxPages} pages ({Count} rows).",
            "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scoularId, from, to, MaxPagesPerWindow, all.Count);

        return new CtrmReadResult<List<CtrmTicketDto>>
        {
            Status = CtrmReadStatus.PartialSuccess,
            Detail = $"Truncated after {MaxPagesPerWindow} pages in {from:yyyy-MM-dd}..{to:yyyy-MM-dd}.",
            Value = all
        };
    }

    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
