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
    private readonly ICtrmGraphQlClient _ctrm;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<CustomerSyncDiagnosticsController> _logger;

    public CustomerSyncDiagnosticsController(
        CustomerSyncService sync,
        ICustomerSyncRepository repository,
        ICustomerSyncSourceFactory sources,
        CtrmCustomerReader customerReader,
        ICtrmGraphQlClient ctrm,
        IWebHostEnvironment env,
        IConfiguration config,
        ILogger<CustomerSyncDiagnosticsController> logger)
    {
        _sync = sync;
        _repository = repository;
        _sources = sources;
        _customerReader = customerReader;
        _ctrm = ctrm;
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

    // -------------------------------------------------------------------------
    /// <summary>
    /// ODS rows vs CTRM rows, side by side: both feeders run as dry runs over the same app state and
    /// <see cref="CustomerSyncComparer"/> diffs them by producer code — customer and trade-unit-link counts, codes
    /// only on one side (at most 25 samples each), and per-field difference counts. Dev/QA only (404 where
    /// <see cref="DiagnosticsEnvironmentGate.IsProductionLike"/>). Writes nothing and reserves no customer ids: the
    /// CTRM feeder on a dry run gives new producers negative placeholder ids, which is why the diff matches on code.
    /// </summary>
    /// <remarks>
    /// When the customers permission is missing, the CTRM half reports <c>Ok: false</c>,
    /// <c>CustomerPermission: "missing"</c> and its discovery report, the ODS half stays populated, and the set and
    /// field diffs are empty — never "0 customers". A feeder that throws is reported as
    /// <c>CUSTOMER_SYNC_SOURCE_UNAVAILABLE</c> with the exception type only, so an ODS outage still yields the CTRM half.
    /// No PII: codes, counts and field names only.
    /// </remarks>
    /// <param name="discoveryFrom">Start of the CTRM link-discovery window instead of the configured trailing window.</param>
    [HttpGet("compare")]
    [ProducesResponseType(typeof(CustomerSyncComparison), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Compare([FromQuery] DateTime? discoveryFrom = null, CancellationToken cancellationToken = default)
    {
        if (DiagnosticsEnvironmentGate.IsProductionLike(_env)) return NotFound();

        var app = new CustomerSyncAppState
        {
            Customers = await _repository.LoadAppCustomersAsync(cancellationToken),
            TradeUnits = await _repository.LoadAppTradeUnitsAsync(cancellationToken)
        };

        // Sequential on purpose: both feeders read through this request's scoped OriginationDbContext, which is not
        // safe for concurrent use — concurrent use of it broke PROD on 2026-09-29.
        var ods = await DryRunAsync(CustomerSyncSources.Ods, app, new CustomerSyncLoadOptions { DryRun = true }, cancellationToken);
        var ctrm = await DryRunAsync(CustomerSyncSources.Ctrm, app, new CustomerSyncLoadOptions { DryRun = true, DiscoveryFrom = discoveryFrom }, cancellationToken);

        var comparison = CustomerSyncComparer.Compare(ods, ctrm, app, DateTime.UtcNow);
        _logger.LogInformation(
            "CustomerSync compare: ods ok {OdsOk} ({OdsCustomers} customers, {OdsLinks} links), ctrm ok {CtrmOk} ({CtrmCustomers} customers, {CtrmLinks} links, permission {Permission}); " +
            "customers {CustomersInBoth} in both / {CustomersOnlyOds} only ods / {CustomersOnlyCtrm} only ctrm; links {LinksInBoth} in both / {LinksOnlyOds} only ods / {LinksOnlyCtrm} only ctrm",
            comparison.Ods.Ok, comparison.Ods.Customers, comparison.Ods.Links,
            comparison.Ctrm.Ok, comparison.Ctrm.Customers, comparison.Ctrm.Links, comparison.Ctrm.CustomerPermission,
            comparison.Customers.InBoth, comparison.Customers.OnlyInOds, comparison.Customers.OnlyInCtrm,
            comparison.Links.InBoth, comparison.Links.OnlyInOds, comparison.Links.OnlyInCtrm);
        return Ok(comparison);
    }

    /// <summary>One feeder's dry run through the factory; a throw becomes a failed side carrying the exception type only.</summary>
    private async Task<CustomerSyncSourceResult> DryRunAsync(
        string sourceName, CustomerSyncAppState app, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
    {
        try
        {
            return await _sources.Create(sourceName).LoadAsync(app, options, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Type only, never the exception object: a SqlException or deserialisation message can carry
            // connection or key detail, and this report is meant to hold codes and counts only.
            _logger.LogWarning(
                "[{ErrorCode}] [{ErrorCategory}] CustomerSync compare: the {Source} feeder threw {ExceptionType}; reporting that side as unavailable",
                SourceUnavailableCode, "Integration", sourceName, ex.GetType().Name);
            return CustomerSyncSourceResult.Failed(sourceName, SourceUnavailableCode, ex.GetType().Name);
        }
    }

    private const string SourceUnavailableCode = "CUSTOMER_SYNC_SOURCE_UNAVAILABLE";

    // -------------------------------------------------------------------------
    /// <summary>
    /// Whether this environment's CTRM client can read the customer master: the customers permission, whether the
    /// nightly projection is accepted, and — given a <paramref name="sourceCode"/> — whether that producer is found
    /// and what JSON type <c>customers.id</c> has (<c>IdKind</c>; never the id value). Dev/QA only (404 where
    /// <see cref="DiagnosticsEnvironmentGate.IsProductionLike"/>). Read-only; at most two GraphQL requests.
    /// </summary>
    /// <param name="sourceCode">A known producer code (<c>ScoularId</c>) to look up with the sync's own document.</param>
    [HttpGet("ctrm-probe")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Probe([FromQuery] string? sourceCode = null, CancellationToken cancellationToken = default)
    {
        if (DiagnosticsEnvironmentGate.IsProductionLike(_env)) return NotFound();

        var r = await _customerReader.ProbeAsync(sourceCode?.Trim(), cancellationToken);
        return Ok(new
        {
            Configured = _ctrm.IsConfigured,
            Source = CustomerSyncSources.Resolve(_config),
            Status = r.Status.ToString(),
            r.HttpStatus,
            r.ErrorCode,
            r.Detail,
            Permission = r.Value?.Permission ?? CtrmCustomerReader.DescribePermission(r),
            r.Value?.TotalCount,
            r.Value?.ProjectionAccepted,
            r.Value?.SampleFound,
            r.Value?.IdKind,
            Note = "Permission 'missing' means Customers.Read.All (or ReadCustomersBasic) is not granted to this client id; the nightly sync on Source=ctrm aborts with CUSTOMER_SYNC_NO_PERMISSION until it is. IdKind is the JSON type of customers.id on the sample row — record it in the app-context doc on the first successful probe (see the plan's §10)."
        });
    }
}
