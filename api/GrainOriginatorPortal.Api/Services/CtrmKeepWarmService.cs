using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Keeps the trade-unit-wide CTRM caches warm for the producer sets users have recently worked with.
/// </summary>
/// <remarks>
/// <para><b>Why.</b> The trade-unit caches are filled when a home page loads and refreshed only when a
/// request happens to arrive after a TTL expires - so the cost of a refresh (contracts: hundreds of
/// per-producer calls; tickets: a multi-minute, 100+ page walk for a large trade unit) lands on whichever
/// user prompts first after a quiet spell. This service re-runs the same reads on a cadence, so the
/// stale-while-revalidate refreshes happen on the clock and a user's prompt always finds a warm cache.</para>
///
/// <para><b>What it can and cannot change.</b> It calls the exact reads the repositories call - same
/// documents, same filters, same caches - so it cannot alter what any screen shows; it only moves the
/// fetch off the user's wait. A failed warm cycle leaves the last good cache in place (failures are never
/// cached) and the next cycle retries. After a restart the registry is empty, so the first home-page load
/// per trade unit still pays cold once per process - by design, because producer sets are resolved from
/// the Origination DB per trade unit and replaying a persisted set could warm the wrong producers.</para>
///
/// <para>Config, read every cycle so App Service overrides apply without a restart:
/// <c>Ctrm:KeepWarmMinutes</c> (cycle cadence, 0 disables), <c>Ctrm:KeepWarmForHours</c> (how long after
/// its last use a set stays maintained). Runs only while <c>Ctrm:Source</c> is <c>ctrm</c>.</para>
/// </remarks>
public sealed class CtrmKeepWarmService : BackgroundService
{
    private readonly CtrmWarmRegistry _registry;
    private readonly CtrmContractReader _contractReader;
    private readonly CtrmTicketReader _ticketReader;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmKeepWarmService> _logger;

    public CtrmKeepWarmService(
        CtrmWarmRegistry registry,
        CtrmContractReader contractReader,
        CtrmTicketReader ticketReader,
        IConfiguration configuration,
        ILogger<CtrmKeepWarmService> logger)
    {
        _registry = registry;
        _contractReader = contractReader;
        _ticketReader = ticketReader;
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

    private async Task WarmActiveSetsAsync(CancellationToken stoppingToken)
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
        foreach (var codes in sets)
        {
            if (stoppingToken.IsCancellationRequested) return;

            try
            {
                var contracts = await _contractReader.GetForProducersAsync(codes, CancellationToken.None);
                if (!contracts.Ok)
                    _logger.LogWarning("CTRM keep-warm: contract read for {Producers} producer(s) did not complete: {Status}.",
                        codes.Count, contracts.Status);

                var tickets = await _ticketReader.GetForProducersHistoryAsync(codes, CancellationToken.None);
                if (!tickets.Ok)
                    _logger.LogWarning("CTRM keep-warm: ticket read for {Producers} producer(s) did not complete: {Status}.",
                        codes.Count, tickets.Status);

                // Spot Loads, explicitly. Its window is -RecentTicketDays/+ForwardTicketDays, which can never
                // coincide with the 366-day history slices above, so warming those left the one read a user
                // watches a spinner for cold on every expiry. The window comes from CtrmTicketRepository so the
                // dates - and therefore the cache key - cannot drift from what the request itself computes.
                var (from, to) = CtrmTicketRepository.SpotLoadWindow(
                    CtrmTicketRepository.RecentTicketDaysFrom(_configuration));
                var spotLoads = await _ticketReader.GetForProducersAsync(codes, from, to, CancellationToken.None);
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

        _logger.LogInformation("CTRM keep-warm: maintained {Sets} producer set(s) in {Elapsed:F0}s.",
            sets.Count, (DateTime.UtcNow - started).TotalSeconds);
    }

    /// <summary>Reads an int setting, falling back when absent or unparseable. See <see cref="CtrmConfig"/>.</summary>
    private int ReadInt(string key, int fallback) => CtrmConfig.ReadInt(_configuration, key, fallback);
}
