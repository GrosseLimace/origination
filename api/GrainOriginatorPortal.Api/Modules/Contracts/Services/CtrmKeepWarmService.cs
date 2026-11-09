using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Ctrm;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;

namespace GrainOriginatorPortal.Api.Modules.Contracts.Services;

/// <summary>
/// Keeps the trade-unit-wide CTRM caches warm for the producer sets users have recently worked with.
/// </summary>
/// <remarks>
/// <para><b>Why.</b> The trade-unit caches are filled when a home page loads and refreshed only when a
/// request happens to arrive after a TTL expires - so the cost of a refresh (contracts: a paged walk per
/// trade unit; Spot Loads: one narrow window) lands on whichever user loads a page first after a quiet
/// spell. This service re-runs the same reads on a cadence, so the stale-while-revalidate refreshes happen
/// on the clock and a page load always finds a warm cache.</para>
///
/// <para><b>The ticket history is not warmed by default (2026-11-04).</b> The three-year trade-unit ticket
/// walk (three 366-day windows, 100+ pages for a large trade unit) was the bulk of our load on the CTRM
/// gateway and its database, and the only screen that reads it is Build-a-List's ticket prompts, which
/// request it themselves when the page opens. So the cycle warms the contract list and Spot Loads - the
/// two reads a page actually waits on - and includes the ticket walk only while
/// <c>Ctrm:KeepWarmTicketHistory</c> is <c>true</c>.</para>
///
/// <para><b>What it can and cannot change.</b> It calls the exact reads the repositories call - same
/// documents, same filters, same caches - so it cannot alter what any screen shows; it only moves the
/// fetch off the user's wait. A failed warm cycle leaves the last good cache in place (failures are never
/// cached) and the next cycle retries. After a restart the registry is empty, so the first home-page load
/// per trade unit still pays cold once per process - by design, because producer sets are resolved from
/// the Origination DB per trade unit and replaying a persisted set could warm the wrong producers.</para>
///
/// <para>Config, read every cycle so an App Service override takes effect after the restart such a
/// change causes: <c>Ctrm:KeepWarmMinutes</c> (cycle cadence, 0 disables), <c>Ctrm:KeepWarmForHours</c>
/// (how long after its last use a set stays maintained), <c>Ctrm:KeepWarmTicketHistory</c> (include the
/// ticket walk; default false). Runs only while <c>Ctrm:Source</c> is <c>ctrm</c>.</para>
/// </remarks>
public sealed class CtrmKeepWarmService : BackgroundService
{
    private readonly CtrmWarmRegistry _registry;
    private readonly ICtrmWarmReads _reads;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmKeepWarmService> _logger;
    private readonly CtrmKeepWarmBackoff _backoff = new();

    public CtrmKeepWarmService(
        CtrmWarmRegistry registry,
        ICtrmWarmReads reads,
        IConfiguration configuration,
        ILogger<CtrmKeepWarmService> logger)
    {
        _registry = registry;
        _reads = reads;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("CtrmKeepWarmService started.");

        // A fixed one-minute tick with the real cadence checked inside, so Ctrm:KeepWarmMinutes can be
        // changed (or the service effectively disabled with 0) via a config override without a restart.
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        var lastRunUtc = DateTime.MinValue;

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                var cadenceMinutes = ReadInt("Ctrm:KeepWarmMinutes", 5);
                if (!ShouldWarmNow(cadenceMinutes, _configuration["Ctrm:Source"], DateTime.UtcNow, lastRunUtc)) continue;

                lastRunUtc = DateTime.UtcNow;
                await WarmActiveSetsAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Shutdown.
        }

        _logger.LogInformation("CtrmKeepWarmService stopped.");
    }

    /// <summary>
    /// Whether this tick should run a warm cycle.
    /// </summary>
    /// <remarks>
    /// Pulled out of the loop so the three gates can be tested without a timer, a registry or a CTRM
    /// server. Every input is read fresh each tick rather than captured at startup, so an App Service
    /// config override takes effect without a restart:
    /// <list type="bullet">
    /// <item><c>Ctrm:KeepWarmMinutes</c> at or below zero disables warming outright.</item>
    /// <item>A cycle that has not yet reached that cadence since <paramref name="lastRunUtc"/> is skipped.</item>
    /// <item>Warming runs only while <c>Ctrm:Source</c> is <c>ctrm</c>, so an environment reading ODS
    /// never issues CTRM traffic.</item>
    /// </list>
    /// All three must pass; any one of them failing skips the tick.
    /// </remarks>
    internal static bool ShouldWarmNow(int cadenceMinutes, string? configuredSource, DateTime nowUtc, DateTime lastRunUtc) =>
        cadenceMinutes > 0
        && nowUtc - lastRunUtc >= TimeSpan.FromMinutes(cadenceMinutes)
        && string.Equals(configuredSource?.Trim(), "ctrm", StringComparison.OrdinalIgnoreCase);

    /// <summary>One warm cycle over every active producer set. Internal so the per-set failure
    /// isolation below can be exercised directly, without the one-minute timer in front of it.</summary>
    internal async Task WarmActiveSetsAsync(CancellationToken stoppingToken)
    {
        var keepFor = TimeSpan.FromHours(Math.Max(1, ReadInt("Ctrm:KeepWarmForHours", 2)));
        var sets = _registry.ActiveSets(keepFor, DateTime.UtcNow);
        if (sets.Count == 0) return;

        // One id for the whole cycle, in the same scope fields HTTP requests get from
        // RequestContextMiddleware. Cycles overlap sets and can interleave under load, so without this
        // there is no field in Log Analytics that narrows the output to a single cycle's lines.
        using var cycleScope = _logger.BeginScope(new Dictionary<string, object?>
        {
            ["ServiceName"] = "GrainOriginatorPortal.Api",
            ["Operation"] = "CtrmKeepWarm.Cycle",
            ["TraceId"] = Guid.NewGuid().ToString("N"),
            ["Sets"] = sets.Count,
        });

        var started = DateTime.UtcNow;

        // One set at a time, contracts then tickets - the same ordering the live path uses, because the
        // contract pages and the ticket walk starve each other when run together. Both reads go through
        // the background throttle and yield to interactive clicks, so this never competes with a user.
        // A set whose read failed is left alone for this long before the cycle tries it again. While the
        // gateway is slow, re-walking every five minutes only queues more queries behind the ones that just
        // timed out (which the server runs to completion regardless) - see CtrmKeepWarmBackoff.
        var backoff = TimeSpan.FromMinutes(Math.Max(1, ReadInt("Ctrm:KeepWarmFailureBackoffMinutes", 15)));

        // Off by default - see the class remarks. Read per cycle like the other knobs.
        var warmTicketHistory = ReadBool("Ctrm:KeepWarmTicketHistory", fallback: false);

        foreach (var codes in sets)
        {
            if (stoppingToken.IsCancellationRequested) return;

            if (_backoff.IsBackedOff(codes, DateTime.UtcNow))
            {
                _logger.LogInformation("CTRM keep-warm: leaving {Producers} producer(s) alone - backed off after a failed cycle.", codes.Count);
                continue;
            }

            try
            {
                var contracts = await _reads.ContractsAsync(codes, CancellationToken.None);
                if (!contracts.Ok)
                {
                    _backoff.Record(codes, DateTime.UtcNow, backoff);
                    _logger.LogWarning("CTRM keep-warm: contract read for {Producers} producer(s) did not complete: {Status}. Skipping the rest of its reads and backing the set off for {Minutes} min.",
                        codes.Count, contracts.Status, backoff.TotalMinutes);
                    continue;
                }

                if (warmTicketHistory)
                {
                    var tickets = await _reads.TicketHistoryAsync(codes, CancellationToken.None);
                    if (!tickets.Ok)
                    {
                        _backoff.Record(codes, DateTime.UtcNow, backoff);
                        _logger.LogWarning("CTRM keep-warm: ticket read for {Producers} producer(s) did not complete: {Status}. Skipping its Spot Loads read and backing the set off for {Minutes} min.",
                            codes.Count, tickets.Status, backoff.TotalMinutes);
                        continue;
                    }
                }

                _backoff.Clear(codes);

                // Spot Loads, explicitly. Its window is -RecentTicketDays/+ForwardTicketDays, which can never
                // coincide with the 366-day history slices above, so warming those left the one read a user
                // watches a spinner for cold on every expiry. The window comes from CtrmTicketRepository so the
                // dates - and therefore the cache key - cannot drift from what the request itself computes.
                var (from, to) = CtrmTicketRepository.SpotLoadWindow(
                    CtrmTicketRepository.RecentTicketDaysFrom(_configuration));
                var spotLoads = await _reads.SpotLoadsAsync(codes, from, to, CancellationToken.None);
                if (!spotLoads.Ok)
                    _logger.LogWarning("CTRM keep-warm: Spot Loads read for {Producers} producer(s) did not complete: {Status}.",
                        codes.Count, spotLoads.Status);
            }
            catch (Exception ex)
            {
                // Never let one set's failure end the service; the caches keep their last good copy.
                _logger.LogWarning(ex, "CTRM keep-warm: cycle for {Producers} producer(s) faulted.", codes.Count);
            }
        }

        // Which reads ran is part of the line, so the traces say whether a cycle included the ticket walk.
        _logger.LogInformation("CTRM keep-warm: maintained {Sets} producer set(s) in {Elapsed:F0}s ({Reads}).",
            sets.Count, (DateTime.UtcNow - started).TotalSeconds,
            warmTicketHistory ? "contracts, ticket history, Spot Loads" : "contracts, Spot Loads");
    }

    /// <summary>Reads an int setting, falling back when absent or unparseable. See <see cref="CtrmConfig"/>.</summary>
    private int ReadInt(string key, int fallback) => CtrmConfig.ReadInt(_configuration, key, fallback);

    /// <summary>Reads a bool setting, falling back when absent or unparseable. See <see cref="CtrmConfig"/>.</summary>
    private bool ReadBool(string key, bool fallback) => CtrmConfig.ReadBool(_configuration, key, fallback);
}
