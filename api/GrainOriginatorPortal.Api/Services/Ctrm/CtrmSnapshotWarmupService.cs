using System.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Services.Ctrm;

/// <summary>
/// Builds the CTRM contract snapshot in the background at startup, so no user request pays for it.
/// </summary>
/// <remarks>
/// <para>Covering the ODS contract population means a window holding 110k+ contracts - a few hundred
/// sequential pages, minutes of wall-clock. Loading that lazily would mean the first producer selection
/// after a deploy simply hangs, which nobody testing the app would read as "warming up".</para>
///
/// <para>Contracts first, then the trade-unit-wide ticket pool. An earlier ticket snapshot was removed because the API had no way to
/// ask for one contract's tickets; now that <c>contractNumbers</c> exists every ticket read is live and
/// per-producer, so pre-fetching a ticket window would be work nothing consumes.</para>
///
/// <para>Failures are logged and swallowed. A warm-up is an optimization: if it fails, the first real
/// request retries through the normal path and reports its own outcome, and taking the API down because
/// a cache could not be pre-filled would be a much worse trade.</para>
/// </remarks>
public sealed class CtrmSnapshotWarmupService : BackgroundService
{
    private readonly CtrmContractSnapshot _snapshot;
    private readonly CtrmTicketPoolSnapshot _ticketPool;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmSnapshotWarmupService> _logger;

    public CtrmSnapshotWarmupService(
        CtrmContractSnapshot snapshot,
        CtrmTicketPoolSnapshot ticketPool,
        IConfiguration configuration,
        ILogger<CtrmSnapshotWarmupService> logger)
    {
        _snapshot = snapshot;
        _ticketPool = ticketPool;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the host finish starting before doing any work - this must never delay readiness.
        await Task.Yield();

        var source = _configuration["Ctrm:Source"]?.Trim();
        if (!string.Equals(source, ContractRepositorySwitch.CtrmSourceValue, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("CTRM snapshot warm-up skipped - Ctrm:Source is '{Source}', not 'ctrm'.",
                string.IsNullOrEmpty(source) ? "(empty)" : source);
            return;
        }

        _logger.LogInformation("CTRM contract snapshot warm-up starting - {ContractFrom}..{ContractTo}.",
            _configuration["Ctrm:ContractDateFrom"], _configuration["Ctrm:ContractDateTo"]);

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var contracts = await _snapshot.GetAsync(stoppingToken);
            Report(contracts.Ok, contracts.Status.ToString(), contracts.Detail,
                contracts.Contracts.Count, contracts.ScannedInWindow, contracts.TotalCountInWindow,
                contracts.Truncated, stopwatch);

            // Tickets AFTER contracts, deliberately. The producer screen can render without the ticket pool
            // (it reads tickets live per producer) but Build-a-List cannot render without the contract pool,
            // so the read more screens wait on lands first. Sequential rather than concurrent because both
            // walks fan out at PageConcurrency and stacking them would double the load on the same gateway.
            var ticketWatch = Stopwatch.StartNew();
            var tickets = await _ticketPool.GetAsync(stoppingToken);
            ticketWatch.Stop();
            if (tickets.Ok)
                _logger.LogInformation(
                    "CTRM ticket pool warm-up finished in {ElapsedSeconds}s: {Count} ticket headers for {Producers} producers across {Windows} window(s){Truncated}.",
                    ticketWatch.Elapsed.TotalSeconds.ToString("F1"), tickets.Tickets.Count, tickets.Producers, tickets.Windows,
                    tickets.Truncated ? " - TRUNCATED" : string.Empty);
            else
                _logger.LogError(
                    "CTRM ticket pool warm-up failed after {ElapsedSeconds}s [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                    ticketWatch.Elapsed.TotalSeconds.ToString("F1"), "INFRASTRUCTURE_CTRM_WARMUP", "Infrastructure",
                    tickets.Status, tickets.Detail);
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
        bool ok, string status, string? detail,
        int retained, int scanned, int totalCount, bool truncated, Stopwatch stopwatch)
    {
        stopwatch.Stop();
        var seconds = stopwatch.Elapsed.TotalSeconds.ToString("F1");

        if (ok)
            _logger.LogInformation(
                "CTRM contract snapshot warm-up finished in {ElapsedSeconds}s: retained {Retained} from {Scanned} " +
                "scanned ({TotalCount} in window){Truncated}.",
                seconds, retained, scanned, totalCount, truncated ? " - TRUNCATED" : string.Empty);
        else
            _logger.LogError(
                "CTRM contract snapshot warm-up failed after {ElapsedSeconds}s [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                seconds, "INFRASTRUCTURE_CTRM_WARMUP", "Infrastructure", status, detail);
    }
}
