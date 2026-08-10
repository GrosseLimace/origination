using System.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Services.Ctrm;

/// <summary>
/// Builds the CTRM contract snapshot in the background at startup, so no user request pays for it.
/// </summary>
/// <remarks>
/// <para>Covering the ODS contract population means a window holding 110k+ contracts — a few hundred
/// sequential pages, minutes of wall-clock. Loading that lazily would mean the first producer selection
/// after a deploy simply hangs, which nobody testing the app would read as "warming up".</para>
///
/// <para>Failures are logged and swallowed. A warm-up is an optimization: if it fails, the first real
/// request retries through the normal path and reports its own outcome, and taking the API down because
/// a cache could not be pre-filled would be a much worse trade.</para>
/// </remarks>
public sealed class CtrmSnapshotWarmupService : BackgroundService
{
    private readonly CtrmContractSnapshot _snapshot;
    private readonly CtrmTicketSnapshot _tickets;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmSnapshotWarmupService> _logger;

    public CtrmSnapshotWarmupService(
        CtrmContractSnapshot snapshot,
        CtrmTicketSnapshot tickets,
        IConfiguration configuration,
        ILogger<CtrmSnapshotWarmupService> logger)
    {
        _snapshot = snapshot;
        _tickets = tickets;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the host finish starting before doing any work — this must never delay readiness.
        await Task.Yield();

        var source = _configuration["Ctrm:Source"]?.Trim();
        if (!string.Equals(source, ContractRepositorySwitch.CtrmSourceValue, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("CTRM snapshot warm-up skipped — Ctrm:Source is '{Source}', not 'ctrm'.",
                string.IsNullOrEmpty(source) ? "(empty)" : source);
            return;
        }

        _logger.LogInformation(
            "CTRM snapshot warm-up starting — contracts {ContractFrom}..{ContractTo}, tickets {TicketFrom}..{TicketTo}.",
            _configuration["Ctrm:ContractDateFrom"], _configuration["Ctrm:ContractDateTo"],
            _configuration["Ctrm:TicketBlDateFrom"], _configuration["Ctrm:TicketBlDateTo"]);

        var stopwatch = Stopwatch.StartNew();
        try
        {
            // TICKETS FIRST, deliberately. Tickets are a three-page walk (~7s) while contracts are
            // eighteen (~195s). Warming the slow one first left the ticket pane unavailable for three
            // minutes for no reason — the cheap win should land immediately.
            var tickets = await _tickets.GetAsync(stoppingToken);
            Report("ticket", tickets.Ok, tickets.Status.ToString(), tickets.Detail,
                tickets.Tickets.Count, tickets.ScannedInWindow, tickets.TotalCountInWindow,
                tickets.Truncated, stopwatch);

            // Sequential rather than concurrent with the ticket walk: the contract walk already fetches
            // its own pages in parallel, and stacking both would compete for the same APIM capacity.
            var contractsWatch = Stopwatch.StartNew();
            var contracts = await _snapshot.GetAsync(stoppingToken);
            Report("contract", contracts.Ok, contracts.Status.ToString(), contracts.Detail,
                contracts.Contracts.Count, contracts.ScannedInWindow, contracts.TotalCountInWindow,
                contracts.Truncated, contractsWatch);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down mid-walk is expected, not an error.
            _logger.LogInformation("CTRM snapshot warm-up cancelled during shutdown.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CTRM snapshot warm-up threw after {ElapsedSeconds}s [{ErrorCode}] [{ErrorCategory}].",
                stopwatch.Elapsed.TotalSeconds.ToString("F1"), "INFRASTRUCTURE_CTRM_WARMUP", "Infrastructure");
        }
    }

    private void Report(
        string kind, bool ok, string status, string? detail,
        int retained, int scanned, int totalCount, bool truncated, Stopwatch stopwatch)
    {
        stopwatch.Stop();
        var seconds = stopwatch.Elapsed.TotalSeconds.ToString("F1");

        if (ok)
            _logger.LogInformation(
                "CTRM {Kind} snapshot warm-up finished in {ElapsedSeconds}s: retained {Retained} from {Scanned} " +
                "scanned ({TotalCount} in window){Truncated}.",
                kind, seconds, retained, scanned, totalCount, truncated ? " — TRUNCATED" : string.Empty);
        else
            _logger.LogError(
                "CTRM {Kind} snapshot warm-up failed after {ElapsedSeconds}s [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                kind, seconds, "INFRASTRUCTURE_CTRM_WARMUP", "Infrastructure", status, detail);
    }
}
