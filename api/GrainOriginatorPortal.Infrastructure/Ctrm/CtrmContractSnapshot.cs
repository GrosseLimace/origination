using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>What a snapshot read produced. Raw DTOs, not entities — see the class remarks on
/// <see cref="CtrmContractSnapshot"/> for why.</summary>
public sealed record CtrmSnapshotResult
{
    public CtrmReadStatus Status { get; init; }
    public bool Ok => Status is CtrmReadStatus.Ok or CtrmReadStatus.PartialSuccess;
    public string? Detail { get; init; }

    /// <summary>Retained rows only — purchase contracts belonging to producers we know about. Far
    /// smaller than the window, which is what makes a wide window affordable.</summary>
    public List<CtrmContractDto> Contracts { get; init; } = [];

    /// <summary>Rows actually walked. Compare against <see cref="TotalCountInWindow"/> to see whether
    /// the page cap cut the walk short.</summary>
    public int ScannedInWindow { get; init; }

    /// <summary>Count for the whole window as CTRM reports it, independent of how much we walked or
    /// retained.</summary>
    public int TotalCountInWindow { get; init; }

    /// <summary>True when the page cap stopped the load while CTRM still had more rows. The result
    /// is a partial view of the window and any producer count taken from it may be understated.</summary>
    public bool Truncated { get; init; }

    public DateTime LoadedAtUtc { get; init; }
    public string? Window { get; init; }
}

/// <summary>
/// Caches one date-window's worth of CTRM contracts and serves every contract read from it.
/// </summary>
/// <remarks>
/// <para><b>Why a snapshot at all.</b> The <c>contracts</c> root field accepts only
/// <c>skip</c>, <c>take</c>, <c>contractDateFrom</c> and <c>contractDateTo</c> — there is no
/// customer argument. A per-producer lookup would therefore mean paging an entire date window and
/// filtering client-side on every request. Fetching the window once and filtering it in memory is
/// the same work done a single time.</para>
///
/// <para><b>Why it serves both the bulk and the per-customer read.</b> The producer screen's
/// contract table is a client-side filter over a trade-unit-wide pool, so the bulk call and the
/// per-customer call both feed the same view. If they came from different sources — or from two
/// snapshots taken at different moments — the same producer could show different contracts
/// depending on which response landed last.</para>
///
/// <para><b>Why it caches DTOs rather than entities.</b> A cached entity graph handed to concurrent
/// requests is a mutation hazard: downstream code that sets a field on a <c>Contract</c> would be
/// editing every other request's copy, and the ODS path it is standing in for returns fresh
/// instances every time. Keeping DTOs means each request maps its own entities, which also lets the
/// repository filter to one producer *before* paying for any mapping.</para>
///
/// <para><b>Scale.</b> This is viable for a narrow window only. ODS holds 40,864 open purchase
/// contracts reaching back to 2025-01-02; covering that population means a ~19-month window, and
/// because there is no <c>contractPrefixType</c> argument the fetch also drags in every sale and
/// closed contract in range — hundreds of requests per rebuild. A customer-filter argument on
/// <c>contracts</c> is what would turn this from a spike into something shippable.</para>
/// </remarks>
public sealed class CtrmContractSnapshot
{
    /// <summary>How long a failed load is remembered before another attempt. Without this, an outage
    /// makes every request pay the full HTTP timeout; with it, one request pays and the rest fail
    /// fast. Deliberately much shorter than the success TTL so a transient failure does not persist.</summary>
    private static readonly TimeSpan FailureBackoff = TimeSpan.FromSeconds(60);

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly IServiceScopeFactory? _scopeFactory;
    private readonly ILogger<CtrmContractSnapshot> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private CtrmSnapshotResult? _cached;
    private DateTime _cachedAtUtc = DateTime.MinValue;

    /// <param name="scopeFactory">
    /// Used to resolve the producer-code filter. This class is a singleton and
    /// <see cref="ApplicationDbContext"/> is scoped, so it cannot be injected directly — a scope is
    /// created per load instead, the same way CustomerSyncService does it. Optional so tests can build
    /// the snapshot without a container; a null factory means no producer filtering.
    /// </param>
    public CtrmContractSnapshot(
        ICtrmGraphQlClient client,
        IConfiguration configuration,
        ILogger<CtrmContractSnapshot> logger,
        IServiceScopeFactory? scopeFactory = null)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Returns the current snapshot, loading or refreshing it if needed. Concurrent callers share one
    /// load rather than each starting their own.
    /// </summary>
    public async Task<CtrmSnapshotResult> GetAsync(CancellationToken cancellationToken)
    {
        if (TryGetFresh(out var fresh))
            return fresh;

        // Try to become the loader WITHOUT waiting. Blocking here was a real defect: the walk can take
        // minutes, so every request that arrived during a build sat on this gate and the producer screen
        // showed a spinner that never resolved. A caller that cannot get the gate is told the state
        // instead, and a retry moments later succeeds.
        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            if (_cached is not null)
                // Expired but usable. Stale contracts beat an empty screen, and the rebuild in flight
                // will replace them shortly.
                return _cached with { Detail = $"Serving the previous snapshot while a rebuild is in progress. {_cached.Detail}".TrimEnd() };

            return new CtrmSnapshotResult
            {
                Status = CtrmReadStatus.Warming,
                Detail = "The CTRM contract snapshot is still being built. Nothing is cached yet — retry shortly."
            };
        }

        try
        {
            // Re-check inside the lock: a caller that queued behind a load in progress should use
            // its result rather than immediately loading again.
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

    /// <summary>Drops the cache so the next read refetches. Used by diagnostics.</summary>
    public void Invalidate()
    {
        _cached = null;
        _cachedAtUtc = DateTime.MinValue;
    }

    /// <summary>
    /// Marks the cached snapshot stale while KEEPING it, so the next read triggers a rebuild but
    /// concurrent readers can still be served the previous copy.
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="Invalidate"/>, which discards the data outright. Prefer this for a
    /// forced refresh: readers keep getting the old snapshot until the new one is ready, instead of
    /// seeing an empty screen for the length of the rebuild.
    /// </remarks>
    public void MarkStale() => _cachedAtUtc = DateTime.MinValue;

    private bool TryGetFresh(out CtrmSnapshotResult result)
    {
        result = default!;
        if (_cached is null) return false;

        var ttl = _cached.Ok
            ? TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:SnapshotMinutes", 30)))
            : FailureBackoff;

        if (DateTime.UtcNow - _cachedAtUtc >= ttl) return false;

        result = _cached;
        return true;
    }

    private async Task<CtrmSnapshotResult> LoadAsync(CancellationToken cancellationToken)
    {
        if (!_client.IsConfigured)
            return new CtrmSnapshotResult
            {
                Status = CtrmReadStatus.NotConfigured,
                Detail = "The CTRM client is not configured — no endpoint, audience or credential."
            };

        // The window is required, not defaulted. An accidental multi-year window is hundreds of
        // sequential requests, so refusing to guess is the safe failure: it reports a
        // misconfiguration immediately instead of appearing to work while stalling the screen.
        if (!TryReadWindow(out var from, out var to, out var windowError))
            return new CtrmSnapshotResult { Status = CtrmReadStatus.NotConfigured, Detail = windowError };

        var pageSize = Math.Clamp(ReadInt("Ctrm:PageSize", 500), 1, 500);
        var maxPages = Math.Max(1, ReadInt("Ctrm:MaxPages", 5));
        var window = $"{from:yyyy-MM-dd} to {to:yyyy-MM-dd}";

        // Producer codes are resolved ONCE per load and used to discard rows as they arrive. Covering
        // the ODS contract population needs a window holding 110k+ contracts, and most of them belong to
        // counterparties and elevators we never display — keeping them would cost hundreds of megabytes
        // to answer questions no screen asks. This is what makes a wide window affordable.
        var producerCodes = await LoadActiveProducerCodesAsync(cancellationToken);
        if (producerCodes.Count == 0)
            return new CtrmSnapshotResult
            {
                Status = CtrmReadStatus.Error,
                Detail = "No active producers with a ScoularId were found in the customer table, so every "
                       + "CTRM contract would be discarded. Refusing to build an empty snapshot.",
                Window = window
            };

        // Page 1 is fetched alone because it carries totalCount, which tells us how many pages exist.
        // Without that the walk has to be sequential — each page's hasNextPage gates the next request —
        // and at ~10s per page that made an 18-page window a 195-second wait after every restart.
        var first = await FetchPageAsync(from, to, skip: 0, pageSize, window, 1, cancellationToken);
        if (first.Failure is not null) return first.Failure;

        var totalCount = first.Page!.TotalCount;

        // hasNextPage is authoritative for "is there more", NOT the totalCount arithmetic. The two can
        // disagree — a first page can return every row while totalCount counts something broader — and
        // trusting the arithmetic alone would fetch a page the server says does not exist, double-counting
        // rows it returns anyway.
        var hasMore = first.Page.PageInfo?.HasNextPage == true;
        var pagesAvailable = pageSize > 0 ? (int)Math.Ceiling(totalCount / (double)pageSize) : 1;
        var pagesToFetch = hasMore ? Math.Min(Math.Max(pagesAvailable, 1), maxPages) : 1;
        var truncated = hasMore && pagesAvailable > maxPages;

        var pages = new CtrmPage<CtrmContractDto>?[pagesToFetch];
        pages[0] = first.Page;
        var partialDetail = first.PartialDetail;

        if (pagesToFetch > 1)
        {
            // Bounded concurrency. Enough to collapse the wait, small enough not to invite a 429 from
            // APIM — a throttled page fails the whole snapshot, so the ceiling matters more than the
            // last few seconds of speed.
            var concurrency = Math.Clamp(ReadInt("Ctrm:PageConcurrency", 4), 1, 8);
            using var slot = new SemaphoreSlim(concurrency, concurrency);
            CtrmSnapshotResult? firstFailure = null;

            var fetches = Enumerable.Range(1, pagesToFetch - 1).Select(async page =>
            {
                await slot.WaitAsync(cancellationToken);
                try
                {
                    var result = await FetchPageAsync(
                        from, to, page * pageSize, pageSize, window, page + 1, cancellationToken);

                    if (result.Failure is not null)
                        Interlocked.CompareExchange(ref firstFailure, result.Failure, null);
                    else
                        pages[page] = result.Page;

                    if (result.PartialDetail is not null) partialDetail ??= result.PartialDetail;
                }
                finally
                {
                    slot.Release();
                }
            });

            await Task.WhenAll(fetches);

            if (firstFailure is not null) return firstFailure;
        }

        var items = new List<CtrmContractDto>();
        var scanned = 0;

        // Reassembled in page order so the retained set is deterministic rather than dependent on which
        // request happened to finish first.
        foreach (var page in pages)
        {
            if (page is null) continue;
            scanned += page.Items.Count;

            // Purchase-only and known-producer-only, so rows we could never display are dropped rather
            // than held.
            items.AddRange(page.Items.Where(d =>
                string.Equals(d.ContractPrefixType?.Trim(), CtrmMappings.PurchasePrefix, StringComparison.OrdinalIgnoreCase)
                && d.CustomerId is not null
                && producerCodes.Contains(d.CustomerId.Trim())));
        }

        if (truncated)
            // Error, not Warning. A truncated window is indistinguishable on screen from a producer
            // who genuinely has no contracts, so this must be loud enough to notice without being
            // asked to look for it.
            _logger.LogError(
                "CTRM contract snapshot TRUNCATED [{ErrorCode}] [{ErrorCategory}]: scanned {Scanned} of {TotalCount} " +
                "contracts in {Window} (retained {Retained}) before hitting the {MaxPages}-page cap. Producers may " +
                "appear to have fewer contracts than they do. Narrow Ctrm:ContractDateFrom/To or raise Ctrm:MaxPages.",
                "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", scanned, totalCount, window, items.Count, maxPages);
        else
            _logger.LogInformation(
                "CTRM contract snapshot loaded: scanned {Scanned} of {TotalCount} contracts in {Window}, " +
                "retained {Retained} purchase contracts for known producers.",
                scanned, totalCount, window, items.Count);

        var truncationNote = truncated
            ? $"TRUNCATED — scanned {scanned} of {totalCount} contracts in {window} before the "
              + $"{maxPages}-page cap. Producer contract lists may be incomplete."
            : null;

        return new CtrmSnapshotResult
        {
            Status = partialDetail is null ? CtrmReadStatus.Ok : CtrmReadStatus.PartialSuccess,
            Detail = truncationNote ?? partialDetail,
            Contracts = items,
            ScannedInWindow = scanned,
            TotalCountInWindow = totalCount,
            Truncated = truncated,
            LoadedAtUtc = DateTime.UtcNow,
            Window = window
        };
    }

    /// <summary>
    /// Every active producer's Scoular code, used to discard CTRM rows we could never display.
    /// </summary>
    /// <remarks>
    /// Not trade-unit scoped on purpose. Trade-unit selection narrows what a user sees, but the snapshot
    /// is shared across users and selections, so it has to retain everything any of them could ask for.
    /// Returns an empty set when no scope factory was supplied, which callers treat as a hard failure
    /// rather than as "keep everything" — silently retaining 110k rows would be the worse outcome.
    /// </remarks>
    /// <summary>Outcome of one page fetch: the page, a categorized failure, or a partial-success note.</summary>
    private readonly record struct PageFetch(
        CtrmPage<CtrmContractDto>? Page,
        CtrmSnapshotResult? Failure,
        string? PartialDetail);

    private async Task<PageFetch> FetchPageAsync(
        DateTime from, DateTime to, int skip, int pageSize, string window, int pageNumber,
        CancellationToken cancellationToken)
    {
        var result = await _client.QueryAsync<CtrmContractsResponse>(
            CtrmQueries.ContractsPage,
            new { from = from.ToString("yyyy-MM-dd"), to = to.ToString("yyyy-MM-dd"), skip, take = pageSize },
            cancellationToken);

        if (!result.Ok)
            return new PageFetch(null, new CtrmSnapshotResult
            {
                Status = result.Status,
                Detail = $"Contract window load failed on page {pageNumber} ({window}): {result.Detail}",
                Window = window
            }, null);

        var page = result.Value?.Contracts;
        if (page is null)
            return new PageFetch(null, new CtrmSnapshotResult
            {
                Status = CtrmReadStatus.Error,
                Detail = $"CTRM returned no contracts object on page {pageNumber} ({window}).",
                Window = window
            }, null);

        return new PageFetch(page, null, result.Status == CtrmReadStatus.PartialSuccess ? result.Detail : null);
    }

    private async Task<HashSet<string>> LoadActiveProducerCodesAsync(CancellationToken cancellationToken)
    {
        if (_scopeFactory is null)
        {
            _logger.LogWarning("CTRM contract snapshot has no service scope factory — cannot resolve producer codes.");
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

    /// <summary>
    /// Reads an int setting, falling back to <paramref name="fallback"/> when absent or unparseable.
    /// </summary>
    /// <remarks>
    /// Uses the indexer rather than <c>IConfiguration.GetValue&lt;int&gt;</c> because that extension
    /// lives in Microsoft.Extensions.Configuration.Binder, which this project does not reference —
    /// and adding a package for three integers is not worth widening the dependency surface.
    /// </remarks>
    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;

    private bool TryReadWindow(out DateTime from, out DateTime to, out string? error)
    {
        from = default;
        to = default;
        error = null;

        var fromRaw = _configuration["Ctrm:ContractDateFrom"]?.Trim();
        var toRaw = _configuration["Ctrm:ContractDateTo"]?.Trim();

        if (string.IsNullOrEmpty(fromRaw) || string.IsNullOrEmpty(toRaw))
        {
            error = "Ctrm:ContractDateFrom and Ctrm:ContractDateTo must both be set (yyyy-MM-dd). "
                  + "There is no default: the contracts field has no customer filter, so a wide window "
                  + "means hundreds of sequential requests per snapshot rebuild.";
            return false;
        }

        if (!DateTime.TryParseExact(fromRaw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out from)
            || !DateTime.TryParseExact(toRaw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out to))
        {
            error = $"Ctrm:ContractDateFrom / Ctrm:ContractDateTo must be yyyy-MM-dd (got '{fromRaw}' and '{toRaw}').";
            return false;
        }

        if (to < from)
        {
            error = $"Ctrm:ContractDateTo ({toRaw}) is before Ctrm:ContractDateFrom ({fromRaw}).";
            return false;
        }

        return true;
    }
}
