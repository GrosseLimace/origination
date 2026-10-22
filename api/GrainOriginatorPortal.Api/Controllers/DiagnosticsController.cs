// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Diagnostics;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// Defense in depth: AdminOnly caller claim + DenyIfNotDevelopment() per-route env gate.
// Both must pass — admin caller running in a non-Dev/QA environment still gets 404.
[Authorize(Policy = "AdminOnly")]
[Produces("application/json")]
public class DiagnosticsController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly CustomerSyncService _customerSync;
    private readonly ISchemaDiagnosticsService _schema;
    private readonly ICtrmDiagnosticsService _ctrm;
    private readonly ICommoditySeedService _commoditySeed;
    private readonly IElevatorCacheDiagnosticsService _elevatorCache;
    private readonly IUsageRollupBackfillService _usageRollups;
    private readonly IAppAccessDiagnosticsService _appAccess;

    public DiagnosticsController(
        IWebHostEnvironment env,
        CustomerSyncService customerSync,
        ISchemaDiagnosticsService schema,
        ICtrmDiagnosticsService ctrm,
        ICommoditySeedService commoditySeed,
        IElevatorCacheDiagnosticsService elevatorCache,
        IUsageRollupBackfillService usageRollups,
        IAppAccessDiagnosticsService appAccess)
    {
        _env = env;
        _customerSync = customerSync;
        _schema = schema;
        _ctrm = ctrm;
        _commoditySeed = commoditySeed;
        _elevatorCache = elevatorCache;
        _usageRollups = usageRollups;
        _appAccess = appAccess;
    }

    // -------------------------------------------------------------------------
    /// <summary>Tests connectivity to all three database contexts. Dev/QA only.</summary>
    [HttpGet("connections")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> CheckConnections()
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _schema.CheckConnectionsAsync());
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// CTRM GraphQL connectivity probe. Answers auth, egress and build-version in one request, so
    /// the spike can fail fast before any mapping code is exercised.
    /// </summary>
    /// <remarks>
    /// Uses a one-row <c>contracts</c> query rather than a schema introspection. Introspection was
    /// available when the API was first validated but the QA gateway now rejects it with
    /// <c>HC0046</c> ("Introspection is not allowed for the current request"), so a probe built on
    /// it would report a failure that says nothing about whether the integration works.
    ///
    /// A single-row data query proves more anyway: a valid token (auth), a reachable gateway
    /// (egress), AND that the API returns contract rows. Read the
    /// Status/Detail pair rather than the HTTP code — the client categorizes NotConfigured /
    /// TokenFailure / EgressBlocked / Unauthorized / Throttled separately because each has a
    /// different remediation.
    /// </remarks>
    [HttpGet("ctrm")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCtrmConnectivity(CancellationToken cancellationToken = default)
    {
        if (DenyIfProduction() is { } deny) return deny;

        return Ok(await _ctrm.GetConnectivityAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Runs one producer's contracts through the real repository path and reports what came back,
    /// including which source served it. Dev/QA only.
    /// </summary>
    /// <remarks>
    /// This exercises the whole chain the producer screen uses — switch, live reader, mapping, status
    /// calculation — rather than a raw query, so it catches the failures a connectivity probe cannot:
    /// a read that succeeds but contains no rows for this producer, or a customer-code mismatch.
    ///
    /// It also makes the ODS-vs-CTRM comparison cheap: call it, flip <c>Ctrm:Source</c>, call it
    /// again, and diff. No restart is needed because the switch re-reads config per call.
    /// </remarks>
    [HttpGet("ctrm/contracts")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCtrmContractsForProducer(
        [FromQuery] string scoularId,
        CancellationToken cancellationToken = default)
    {
        if (DenyIfProduction() is { } deny) return deny;

        if (string.IsNullOrWhiteSpace(scoularId))
            return BadRequest(new { Error = "scoularId is required (the Scoular customer code, e.g. TATOBIN)." });

        return Ok(await _ctrm.GetContractsForProducerAsync(scoularId.Trim(), cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Probes whether the API accepts multiple aliased root fields in one document.
    /// </summary>
    /// <remarks>
    /// This decides the whole ticket strategy. The API has no customer filter, so a producer's
    /// tickets have to be read individually by composite key. If aliasing works, N key lookups
    /// collapse into ONE request; if it doesn't, they stay N sequential round trips at ~350ms
    /// each and the per-producer count has to be capped.
    ///
    /// Both aliases deliberately request the SAME known-good ticket — we are testing whether the
    /// server accepts the document shape, not whether the tickets exist.
    /// </remarks>
    [HttpGet("ctrm/alias-batch")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCtrmAliasBatchSupport(CancellationToken cancellationToken = default)
    {
        if (DenyIfProduction() is { } deny) return deny;

        return Ok(await _ctrm.GetAliasBatchSupportAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Returns 404 unless running in Development or QA.</summary>
    /// <remarks>
    /// These endpoints expose internal DB schema structure and must never be
    /// accessible in production. security-guide.md §4.3 (least privilege).
    /// </remarks>
    private IActionResult? DenyIfNotDevelopment()
        => _env.IsDevelopment() || _env.IsEnvironment("QA") ? null : NotFound();

    // -------------------------------------------------------------------------
    /// <summary>Returns 404 in production only — allows local Development plus the deployed
    /// Dev and QA environments.</summary>
    /// <remarks>
    /// Deployed non-prod App Services run with ASPNETCORE_ENVIRONMENT set to "Dev" or "QA", so
    /// <see cref="DenyIfNotDevelopment"/> (which tests IsDevelopment, i.e. "Development") 404s on
    /// deployed Dev. The CTRM probes need to be reachable there specifically, because running them
    /// from the App Service is the only way to test egress from inside the VNet rather than from a
    /// workstation on VPN. These endpoints report connectivity status only — no schema, no data.
    /// </remarks>
    private IActionResult? DenyIfProduction()
        => _env.IsDevelopment() || _env.IsEnvironment("Dev") || _env.IsEnvironment("QA")
            ? null
            : NotFound();

    // -------------------------------------------------------------------------
    /// <summary>
    /// Times one producer's screen the way the client loads it, stage by stage. Dev/QA only.
    /// </summary>
    /// <remarks>
    /// <para>Every latency decision on the CTRM path so far has rested on hand-run probes, and two of them
    /// disagreed - one probe saw splitting a ticket window help, another saw it hurt. This exists so those
    /// questions can be settled against the real repository stack instead: the same caching, throttling,
    /// retry and mapping a click goes through, with a stopwatch and the provenance string per stage.</para>
    ///
    /// <para><c>cold=true</c> invalidates both readers for the producer first, which is the only honest way
    /// to measure a first click - otherwise the short per-producer cache answers and everything looks fast.
    /// Contracts and tickets run CONCURRENTLY because that is how the client fires them; measuring them in
    /// sequence would report a wall time no user experiences.</para>
    ///
    /// <para>No producer data in the response beyond row counts and the code that was asked for.</para>
    /// </remarks>
    [HttpGet("ctrm/producer-timing")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCtrmProducerTiming(
        [FromQuery] string scoularId,
        [FromQuery] bool cold = false,
        CancellationToken cancellationToken = default)
    {
        if (DenyIfProduction() is { } deny) return deny;

        if (string.IsNullOrWhiteSpace(scoularId))
            return BadRequest(new { Error = "scoularId is required (the Scoular customer code, e.g. TATOBIN)." });

        var code = scoularId.Trim();
        if (code.Length > CtrmCustomerCodes.MaxLength * 2)
            return BadRequest(new { Error = "scoularId is not a plausible customer code." });

        return Ok(await _ctrm.GetProducerTimingAsync(code, cold, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Lists all user tables in the connected database.</summary>
    [HttpGet("tables")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTables(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _schema.GetTablesAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets schema/table info for a specific table name.</summary>
    [HttpGet("tableschema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableWithSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _schema.GetTableWithSchemaAsync(tableName, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets column definitions for a specific table.</summary>
    [HttpGet("schema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _schema.GetTableSchemaAsync(tableName, cancellationToken));
    }

    /// <summary>
    /// Manual on-demand trigger for the customer sync. Available in all
    /// environments to admins (gated by the controller-level
    /// <c>[Authorize(Policy = "AdminOnly")]</c>) — useful when prod needs an
    /// out-of-cycle refresh ahead of the next scheduled
    /// <see cref="CustomerSyncBackgroundService"/> run.
    ///
    /// Invokes the same upsert / soft-delete logic the scheduled service uses
    /// (see Services/CustomerSyncService). Replaces the legacy
    /// POST /api/diagnostics/customer-snapshot/populate endpoint that did a
    /// destructive DELETE+INSERT — the new sync preserves FK references from
    /// Notes / ProducerDetails / ProducerPlantingIntentions by soft-deleting.
    /// </summary>
    [HttpPost("customer-sync/run")]
    [ProducesResponseType(typeof(CustomerSyncResult), StatusCodes.Status200OK)]
    public async Task<IActionResult> RunCustomerSync(CancellationToken cancellationToken = default)
    {
        var result = await _customerSync.SyncAsync(cancellationToken);
        return Ok(result);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Rebuilds the usage-dashboard daily rollups for the last <paramref name="days"/> days from the
    /// raw UserActivity / UserClickEvent tables. The hourly aggregation job only ever processes the
    /// previous day, so this is how the rollups get populated for history that predates them —
    /// run it once after deploying, otherwise the dashboard's historical charts read empty tables.
    /// Also useful after a feature-code mapping change, since aggregation is a full recompute.
    /// <para>Admin-gated by the controller policy; capped at the raw-table retention window since
    /// there is nothing older to aggregate from.</para>
    /// </summary>
    [HttpPost("usage-rollups/backfill")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> BackfillUsageRollups(
        [FromQuery] int days = 90,
        CancellationToken cancellationToken = default)
    {
        return Ok(await _usageRollups.BackfillAsync(days, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// App-access spike: reads the transitive member list of the Entra group configured at
    /// <c>AppAccess:GroupName</c> via Microsoft Graph, using the App Service managed identity
    /// (or the developer's own credential locally). Always 200 — the <c>Outcome</c> field is the
    /// verdict: Ok, or a categorized reason (EgressBlocked = NSG outbound rule needed,
    /// PermissionMissing = GroupMember.Read.All grant needed, TokenFailure, NotFound, NotConfigured).
    ///
    /// Deliberately NOT gated by <see cref="DenyIfNotDevelopment"/> (like customer-sync/run):
    /// the deployed dev environment runs ASPNETCORE_ENVIRONMENT=Dev, which that gate would 404 —
    /// and deployed Dev is exactly where the managed identity's Graph access must be proven.
    /// Read-only; admin-gated by the controller-level policy.
    /// </summary>
    [HttpGet("app-access-group-members")]
    [ProducesResponseType(typeof(AppAccessGroupMembersResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAppAccessGroupMembers(CancellationToken cancellationToken = default)
    {
        return Ok(await _appAccess.GetGroupMembersAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Seeds dbo.Commodities from distinct CommodityCode/CommodityDescription in ODS contracts.
    /// Skips codes that already exist. Dev/QA only.
    /// </summary>
    [HttpPost("commodities/seed")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> SeedCommodities(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _commoditySeed.SeedAsync(cancellationToken));
    }

    /// <summary>
    /// Copies all elevators from ODS ctrm.vw_GNP026 into dbo.ElevatorCache.
    /// Upserts by ElevatorCode — existing rows are updated, new rows are inserted.
    /// Optionally geocodes elevators missing coordinates (pass ?geocode=true, slow ~1 req/sec).
    /// Dev/QA only.
    /// </summary>
    [HttpPost("elevator-cache/refresh")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> RefreshElevatorCache([FromQuery] bool geocode = false, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _elevatorCache.RefreshAsync(geocode, cancellationToken));
    }

    /// <summary>
    /// Starts geocoding all elevators missing coordinates in the background.
    /// Returns immediately with estimated time. Check progress via GET elevator-cache/geocode-status.
    /// </summary>
    [HttpPost("elevator-cache/geocode")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    // No CancellationToken parameter: this is fire-and-forget. The background work in the service
    // deliberately outlives the request and takes a fresh scope, so a request-scoped token would
    // be cancelled the moment we return 202. One used to be declared here and silently ignored,
    // which read as if the work were cancellable.
    public IActionResult StartElevatorGeocode()
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        if (_elevatorCache.TryStartBackgroundGeocode() is not { } started)
            return Conflict(new { Message = "Geocoding is already in progress." });

        return Accepted(started);
    }

    /// <summary>Returns current geocoding progress.</summary>
    [HttpGet("elevator-cache/geocode-status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetGeocodeStatus(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _elevatorCache.GetGeocodeStatusAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Geocode missing elevators using zip code centroids (zippopotam.us).</summary>
    [HttpPost("elevator-cache/geocode-zip")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GeocodeByZip(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        return Ok(await _elevatorCache.GeocodeByZipAsync(cancellationToken));
    }
}
