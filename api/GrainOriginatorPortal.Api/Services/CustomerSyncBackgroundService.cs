using System.Globalization;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Background service that runs <see cref="CustomerSyncService"/> once a day at
/// a configured UTC time. The schedule is set by <c>CustomerSync:RunAtTimeUtc</c>
/// in appsettings (HH:mm UTC, e.g. "01:00" for 01:00 UTC).
///
/// To disable the scheduled run entirely (e.g. on dev), set the value to an
/// empty string in the environment's appsettings file. The dev-only manual
/// trigger endpoint at POST /api/diagnostics/customer-sync/run is unaffected.
///
/// Invalid or missing time values produce a single warning and the service
/// exits without running — fail-safe over a noisy default.
/// </summary>
public class CustomerSyncBackgroundService : BackgroundService
{
    private readonly CustomerSyncService _sync;
    private readonly IConfiguration _config;
    private readonly ILogger<CustomerSyncBackgroundService> _logger;

    public CustomerSyncBackgroundService(
        CustomerSyncService sync,
        IConfiguration config,
        ILogger<CustomerSyncBackgroundService> logger)
    {
        _sync = sync;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var timeStr = _config.GetValue<string>("CustomerSync:RunAtTimeUtc")?.Trim();
        // Empty / missing / "0" all mean "disabled". Note: "00:00" is a VALID
        // schedule (midnight UTC) — only the literal "0" gets the disable
        // shortcut so someone scheduling a midnight run isn't accidentally
        // silenced.
        if (string.IsNullOrWhiteSpace(timeStr) || timeStr == "0")
        {
            _logger.LogInformation(
                "CustomerSyncBackgroundService disabled — CustomerSync:RunAtTimeUtc is empty / 0. " +
                "Use POST /api/diagnostics/customer-sync/run for on-demand sync.");
            return;
        }

        if (!TimeOnly.TryParse(timeStr, CultureInfo.InvariantCulture, out var scheduledUtc))
        {
            _logger.LogWarning(
                "CustomerSyncBackgroundService disabled — CustomerSync:RunAtTimeUtc value '{Value}' " +
                "is not a valid time. Expected HH:mm UTC format (e.g. '01:00').",
                timeStr);
            return;
        }

        _logger.LogInformation(
            "CustomerSyncBackgroundService started — scheduled to run daily at {Time} UTC",
            scheduledUtc.ToString("HH:mm", CultureInfo.InvariantCulture));

        // Run once on startup so a freshly-deployed instance has current data
        // without waiting up to a day for the first scheduled cycle. A short
        // stabilization delay lets the rest of the host finish wiring up.
        try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
        catch (OperationCanceledException) { return; }

        await RunSyncSafelyAsync(stoppingToken, "startup");

        while (!stoppingToken.IsCancellationRequested)
        {
            var nextRun = ComputeNextRunUtc(scheduledUtc);
            var delay = nextRun - DateTime.UtcNow;
            _logger.LogInformation(
                "CustomerSync next run scheduled for {NextRunUtc:O} (in {DelayHours:F1} hours)",
                nextRun, delay.TotalHours);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }

            await RunSyncSafelyAsync(stoppingToken, "scheduled");
        }

        _logger.LogInformation("CustomerSyncBackgroundService stopped");
    }

    /// <summary>
    /// Wraps a sync invocation so transient errors don't crash the host —
    /// logs and returns so the loop keeps the schedule alive.
    /// </summary>
    private async Task RunSyncSafelyAsync(CancellationToken stoppingToken, string reason)
    {
        try
        {
            await _sync.SyncAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown — let the caller exit cleanly.
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CustomerSync {Reason} cycle failed — will retry at next scheduled run", reason);
        }
    }

    /// <summary>
    /// Returns the next UTC DateTime matching the scheduled HH:mm — today's
    /// occurrence if it's still in the future, otherwise tomorrow's.
    /// </summary>
    private static DateTime ComputeNextRunUtc(TimeOnly scheduledUtc)
    {
        var now = DateTime.UtcNow;
        var todayAtScheduled = new DateTime(
            now.Year, now.Month, now.Day,
            scheduledUtc.Hour, scheduledUtc.Minute, 0,
            DateTimeKind.Utc);
        return todayAtScheduled > now
            ? todayAtScheduled
            : todayAtScheduled.AddDays(1);
    }
}
