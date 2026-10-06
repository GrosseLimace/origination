// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Admin-only diagnostics for the nightly customer sync (<see cref="CustomerSyncService"/>). Nothing here writes
/// customer data except <c>POST run</c> without <c>dryRun</c>. Responses carry codes and counts only — never
/// customer names, emails, phones or addresses.
/// </summary>
[ApiController]
[Route("api/diagnostics/customer-sync")]
[Authorize(Policy = "AdminOnly")]
[Produces("application/json")]
public class CustomerSyncDiagnosticsController : ControllerBase
{
    private readonly CustomerSyncService _sync;
    private readonly ICustomerSyncRepository _repository;
    private readonly ICustomerSyncSourceFactory _sources;
    private readonly CtrmCustomerReader _customerReader;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<CustomerSyncDiagnosticsController> _logger;

    public CustomerSyncDiagnosticsController(
        CustomerSyncService sync,
        ICustomerSyncRepository repository,
        ICustomerSyncSourceFactory sources,
        CtrmCustomerReader customerReader,
        IWebHostEnvironment env,
        IConfiguration config,
        ILogger<CustomerSyncDiagnosticsController> logger)
    {
        _sync = sync;
        _repository = repository;
        _sources = sources;
        _customerReader = customerReader;
        _env = env;
        _config = config;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Manual on-demand trigger for the customer sync. Available in all environments to admins (gated by the
    /// controller-level <c>[Authorize(Policy = "AdminOnly")]</c>, no environment gate) — PROD is where it matters:
    /// an out-of-cycle refresh ahead of the next scheduled <see cref="CustomerSyncBackgroundService"/> run, and the
    /// recovery from a tripped mass-deactivation guard (<c>?force=true</c>, once the deactivation is known to be
    /// legitimate; check it first with <c>?dryRun=true</c>).
    ///
    /// Invokes the same upsert / soft-delete logic the scheduled service uses (see Services/CustomerSyncService),
    /// which preserves FK references from Notes / ProducerDetails / ProducerPlantingIntentions by soft-deleting.
    /// </summary>
    /// <param name="dryRun">Compute every pass and the guard verdict; write nothing.</param>
    /// <param name="force">Bypass the mass-deactivation guard. Never bypasses a failed source.</param>
    /// <param name="source"><c>ods</c> or <c>ctrm</c> instead of <c>CustomerSync:Source</c>; only with <paramref name="dryRun"/>, else 400.</param>
    /// <param name="discoveryFrom">Start of the CTRM link-discovery window instead of the configured trailing window.</param>
    /// <returns>200 with the run's <see cref="CustomerSyncResult"/>; 409 with the same body when the run aborted (nothing written).</returns>
    [HttpPost("run")]
    [ProducesResponseType(typeof(CustomerSyncResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(CustomerSyncResult), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Run(
        [FromQuery] bool dryRun = false,
        [FromQuery] bool force = false,
        [FromQuery] string? source = null,
        [FromQuery] DateTime? discoveryFrom = null,
        CancellationToken cancellationToken = default)
    {
        if (source is not null && !dryRun)
            return BadRequest(new { Error = "source may only be overridden on a dry run (dryRun=true)." });

        var result = await _sync.SyncAsync(
            new CustomerSyncOptions { DryRun = dryRun, Force = force, SourceOverride = source, DiscoveryFrom = discoveryFrom, Trigger = "manual" },
            cancellationToken);
        return result.Aborted ? StatusCode(StatusCodes.Status409Conflict, result) : Ok(result);
    }

    /// <summary>
    /// A run is stale when no non-dry run has succeeded for this long: one daily schedule plus slack. A constant,
    /// not a config key — nothing else reads it.
    /// </summary>
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(26);

    // -------------------------------------------------------------------------
    /// <summary>
    /// The customer sync's last NON-dry run (startup, scheduled or manual), kept in memory by the singleton
    /// <see cref="CustomerSyncService"/>, plus when the last successful one finished. No environment gate (same
    /// posture as <c>POST run</c>): PROD is where a tripped mass-deactivation guard must be visible without KQL.
    /// </summary>
    /// <remarks>
    /// A null <c>LastRun</c> right after a deploy is normal — the startup sync runs 60 s after boot
    /// (<c>ProcessStartedUtc</c> says when the process started); <c>Stale: true</c> with a non-null aborted
    /// <c>LastRun</c> is the signal the outage recovery playbook asks for. No PII is possible:
    /// <see cref="CustomerSyncLastRun"/> holds codes, counters and an exception type name.
    /// </remarks>
    /// <returns>200 <c>{ ProcessStartedUtc, NowUtc, LastSuccessfulRunUtc, Stale, LastRun }</c>.</returns>
    [HttpGet("last-run")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult LastRun()
    {
        var now = DateTime.UtcNow;
        return Ok(new
        {
            ProcessStartedUtc = _sync.StartedUtc,
            NowUtc = now,
            _sync.LastSuccessfulRunUtc,
            Stale = _sync.LastSuccessfulRunUtc is not { } ok || now - ok > StaleAfter,
            _sync.LastRun
        });
    }
}
