using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>What a ticket snapshot read produced.</summary>
public sealed record CtrmTicketSnapshotResult
{
    public CtrmReadStatus Status { get; init; }
    public bool Ok => Status is CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess;
    public string? Detail { get; init; }

    /// <summary>Retained tickets, with detail rows pruned to producers we know about.</summary>
    public List<CtrmTicketDto> Tickets { get; init; } = [];

    public int ScannedInWindow { get; init; }
    public int TotalCountInWindow { get; init; }
    public bool Truncated { get; init; }
    public DateTime LoadedAtUtc { get; init; }
    public string? Window { get; init; }
}

/// <summary>
/// Caches one bill-of-lading window's worth of CTRM tickets and serves every per-producer ticket read
/// from it.
/// </summary>
/// <remarks>
/// <para><b>This replaces an ODS-indexed design.</b> The first attempt asked ODS which ticket keys
/// belonged to a producer and then fetched each from CTRM by composite key. That worked, but it meant
/// ODS still decided which tickets existed — so a ticket CTRM knew about and ODS had not yet ingested
/// simply never appeared, which defeats the point of reading from CTRM at all. Walking the window
/// removes ODS from discovery entirely.</para>
///
/// <para><b>It is affordable because the window is small.</b> Measured against QA: all of 2026 is 1,407
/// tickets — three pages, under 8 seconds. Volume is very uneven though, so the window must be sized
/// from measurement rather than assumed: November–December 2025 alone is 81,964 tickets (164 pages) and
/// all of 2025 is 940,902.</para>
///
/// <para><b>The range is capped by the server at 366 days</b> (<see cref="CtrmQueries.MaxTicketRangeDays"/>),
/// unlike the contract window. A wider request is rejected with a VALIDATION error, so it is checked
/// here and reported as a configuration problem rather than surfacing as a failed read.</para>
/// </remarks>
public sealed class CtrmTicketSnapshot
{
    private static readonly TimeSpan FailureBackoff = TimeSpan.FromSeconds(60);

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly ILogger<CtrmTicketSnapshot> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private CtrmTicketSnapshotResult? _cached;
    private DateTime _cachedAtUtc = DateTime.MinValue;

    public CtrmTicketSnapshot(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmTicketSnapshot> logger,
        IServiceScopeFactory? scopeFactory = null)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Returns the current snapshot, building or refreshing it when needed. Never blocks on a build in
    /// progress — see <see cref="CtrmReadStatus.Warming"/>.
    /// </summary>
    public async Task<CtrmTicketSnapshotResult> GetAsync(CancellationToken cancellationToken)
    {
        if (TryGetFresh(out var fresh))
            return fresh;

        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            if (_cached is not null)
                return _cached with { Detail = $"Serving the previous snapshot while a rebuild is in progress. {_cached.Detail}".TrimEnd() };

            return new CtrmTicketSnapshotResult
            {
                Status = CtrmReadStatus.Warming,
                Detail = "The CTRM ticket snapshot is still being built. Nothing is cached yet — retry shortly."
            };
        }

        try
        {
            if (TryGetFresh(out var loaded))
                return loaded;

            var result = await LoadAsync(cancellationToken);
            _cached = result;
            _cachedAtUtc = DateTime.UtcNow;
            return result;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Discards the cache so the next read refetches.</summary>
    public void Invalidate()
    {
        _cached = null;
        _cachedAtUtc = DateTime.MinValue;
    }

    /// <summary>Marks the snapshot stale but keeps it, so readers see the old copy during the rebuild.</summary>
    public void MarkStale() => _cachedAtUtc = DateTime.MinValue;

    private bool TryGetFresh(out CtrmTicketSnapshotResult result)
    {
        result = default!;
        if (_cached is null) return false;

        var ttl = _cached.Ok
            ? TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:TicketSnapshotMinutes", ReadInt("Ctrm:SnapshotMinutes", 30))))
            : FailureBackoff;

        if (DateTime.UtcNow - _cachedAtUtc >= ttl) return false;

        result = _cached;
        return true;
    }

    private async Task<CtrmTicketSnapshotResult> LoadAsync(CancellationToken cancellationToken)
    {
        if (!_client.IsConfigured)
            return new CtrmTicketSnapshotResult
            {
                Status = CtrmReadStatus.NotConfigured,
                Detail = "The CTRM client is not configured — no endpoint, audience or credential."
            };

        if (!TryReadWindow(out var from, out var to, out var windowError))
            return new CtrmTicketSnapshotResult { Status = CtrmReadStatus.NotConfigured, Detail = windowError };

        var window = $"{from:yyyy-MM-dd} to {to:yyyy-MM-dd}";

        var producerCodes = await LoadActiveProducerCodesAsync(cancellationToken);
        if (producerCodes.Count == 0)
            return new CtrmTicketSnapshotResult
            {
                Status = CtrmReadStatus.Error,
                Detail = "No active producers with a ScoularId were found in the customer table, so every CTRM "
                       + "ticket would be discarded. Refusing to build an empty snapshot.",
                Window = window
            };

        var pageSize = Math.Clamp(ReadInt("Ctrm:TicketPageSize", 500), 1, 500);
        var maxPages = Math.Max(1, ReadInt("Ctrm:TicketMaxPages", 10));

        var kept = new List<CtrmTicketDto>();
        var totalCount = 0;
        var scanned = 0;
        var truncated = false;
        var partialDetail = (string?)null;
        var skip = 0;

        for (var page = 0; ; page++)
        {
            if (page >= maxPages)
            {
                truncated = true;
                break;
            }

            var result = await _client.QueryAsync<CtrmTicketsResponse>(
                CtrmQueries.TicketsPage,
                new { from = from.ToString("yyyy-MM-dd"), to = to.ToString("yyyy-MM-dd"), skip, take = pageSize },
                cancellationToken);

            if (!result.Ok)
                return new CtrmTicketSnapshotResult
                {
                    Status = result.Status,
                    Detail = $"Ticket window load failed on page {page + 1} ({window}): {result.Detail}",
                    Window = window
                };

            if (result.Status == CtrmReadStatus.PartialSuccess)
                partialDetail = result.Detail;

            var pageData = result.Value?.Tickets;
            if (pageData is null)
                return new CtrmTicketSnapshotResult
                {
                    Status = CtrmReadStatus.Error,
                    Detail = $"CTRM returned no tickets object on page {page + 1} ({window}).",
                    Window = window
                };

            totalCount = pageData.TotalCount;
            scanned += pageData.Items.Count;

            // Prune each ticket's details down to rows belonging to producers we know about, and keep the
            // header only if something survived. A physical ticket is often split across many parties, so
            // most detail rows on a kept ticket still belong to someone we never display.
            foreach (var ticket in pageData.Items)
            {
                var mine = ticket.Details
                    .Where(d => d.CustomerCode is not null && producerCodes.Contains(d.CustomerCode.Trim()))
                    .ToList();

                if (mine.Count == 0) continue;

                ticket.Details = mine;
                kept.Add(ticket);
            }

            if (page > 0 && page % 25 == 0)
                _logger.LogInformation(
                    "CTRM ticket snapshot loading: page {Page}, scanned {Scanned} of {TotalCount}, retained {Retained}.",
                    page + 1, scanned, totalCount, kept.Count);

            if (pageData.PageInfo?.HasNextPage != true)
                break;

            skip += pageSize;
        }

        var detailRows = kept.Sum(t => t.Details.Count);

        if (truncated)
            _logger.LogError(
                "CTRM ticket snapshot TRUNCATED [{ErrorCode}] [{ErrorCategory}]: scanned {Scanned} of {TotalCount} " +
                "tickets in {Window} (retained {Retained}) before the {MaxPages}-page cap. Producers may appear to " +
                "have fewer tickets than they do. Narrow the window or raise Ctrm:TicketMaxPages.",
                "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scanned, totalCount, window, kept.Count, maxPages);
        else
            _logger.LogInformation(
                "CTRM ticket snapshot loaded: scanned {Scanned} of {TotalCount} tickets in {Window}, retained " +
                "{Retained} tickets / {DetailRows} detail rows for known producers.",
                scanned, totalCount, window, kept.Count, detailRows);

        var truncationNote = truncated
            ? $"TRUNCATED — scanned {scanned} of {totalCount} tickets in {window} before the "
              + $"{maxPages}-page cap. Producer ticket lists may be incomplete."
            : null;

        return new CtrmTicketSnapshotResult
        {
            Status = partialDetail is null ? CtrmReadStatus.Ok : CtrmReadStatus.PartialSuccess,
            Detail = truncationNote ?? partialDetail,
            Tickets = kept,
            ScannedInWindow = scanned,
            TotalCountInWindow = totalCount,
            Truncated = truncated,
            LoadedAtUtc = DateTime.UtcNow,
            Window = window
        };
    }

    private async Task<HashSet<string>> LoadActiveProducerCodesAsync(CancellationToken cancellationToken)
    {
        if (_scopeFactory is null)
        {
            _logger.LogWarning("CTRM ticket snapshot has no service scope factory — cannot resolve producer codes.");
            return [];
        }

        using var scope = _scopeFactory.CreateScope();
        var appContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var codes = await appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null)
            .Select(c => c.ScoularId!)
            .ToListAsync(cancellationToken);

        return new HashSet<string>(codes.Select(c => c.Trim()), StringComparer.OrdinalIgnoreCase);
    }

    private bool TryReadWindow(out DateTime from, out DateTime to, out string? error)
    {
        from = default;
        to = default;
        error = null;

        var fromRaw = _configuration["Ctrm:TicketBlDateFrom"]?.Trim();
        var toRaw = _configuration["Ctrm:TicketBlDateTo"]?.Trim();

        if (string.IsNullOrEmpty(fromRaw) || string.IsNullOrEmpty(toRaw))
        {
            error = "Ctrm:TicketBlDateFrom and Ctrm:TicketBlDateTo must both be set (yyyy-MM-dd). No default: "
                  + "ticket volume varies by orders of magnitude between periods, so the window has to be chosen "
                  + "deliberately.";
            return false;
        }

        if (!DateTime.TryParseExact(fromRaw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out from)
            || !DateTime.TryParseExact(toRaw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out to))
        {
            error = $"Ctrm:TicketBlDateFrom / Ctrm:TicketBlDateTo must be yyyy-MM-dd (got '{fromRaw}' and '{toRaw}').";
            return false;
        }

        if (to < from)
        {
            error = $"Ctrm:TicketBlDateTo ({toRaw}) is before Ctrm:TicketBlDateFrom ({fromRaw}).";
            return false;
        }

        // Checked here so an over-wide window reads as a configuration error rather than a failed read.
        var days = (to - from).TotalDays;
        if (days > CtrmQueries.MaxTicketRangeDays)
        {
            error = $"The CTRM tickets field rejects a bill-of-lading range wider than "
                  + $"{CtrmQueries.MaxTicketRangeDays} days; this window is {days:F0}. Narrow "
                  + "Ctrm:TicketBlDateFrom/To. (The contracts field has no such limit, so the two windows are "
                  + "configured separately.)";
            return false;
        }

        return true;
    }

    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
}
