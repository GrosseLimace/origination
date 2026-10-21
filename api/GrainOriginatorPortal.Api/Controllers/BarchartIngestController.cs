using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Ingestion endpoints for the BarChart bid feed — the front door the data pipeline calls.
///
/// The pipeline (an Azure Data Factory owned by the integration team) fetches from BarChart on a
/// schedule and forwards each response here; it has no database access of its own, which keeps this
/// application the only writer to its own database. The contract handed to that team lives at
/// docs/application-context/Barchart Ingestion API Contract.md.
///
/// Authorization is the <c>BarchartIngest</c> policy: the pipeline's managed identity holding the
/// <c>Origination.Application</c> app role, or an Admin (so the feed can be exercised and re-run by
/// hand). Callers are machine identities with no user context, so nothing on this path consults
/// trade-unit entitlements.
///
/// Every endpoint is safe to retry: loads upsert, the daily history row is replaced per business
/// date, and the bridge is deterministic. A failed pipeline run can simply be run again.
/// </summary>
[ApiController]
[Route("api/barchart-ingest")]
[Authorize(Policy = "BarchartIngest")]
[Produces("application/json")]
public class BarchartIngestController : ControllerBase
{
    private readonly IBarchartIngestService _service;

    public BarchartIngestController(IBarchartIngestService service)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
    }

    /// <summary>
    /// Files a vendor instrument (catalog) payload — the locations and bids BarChart offers.
    /// </summary>
    /// <remarks>
    /// POST the vendor's <c>getGrainInstruments</c> response body unmodified and uncompressed. Symbols
    /// absent from the payload are left alone; use <c>deactivate-instruments</c> after a complete sweep.
    /// </remarks>
    [HttpPost("instruments")]
    [RequestSizeLimit(BarchartIngestService.MaxPayloadBytes)]
    [ProducesResponseType(typeof(BarchartInstrumentLoadResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartInstrumentLoadResponse>> LoadInstruments(
        CancellationToken cancellationToken = default)
    {
        var json = await ReadBodyAsync(cancellationToken);
        return Ok(await _service.LoadInstrumentsAsync(json, cancellationToken));
    }

    /// <summary>
    /// Files a vendor quote payload — the current price for each symbol.
    /// </summary>
    /// <param name="snapshotDate">
    /// Business date to record the day's history under. Omit to use today in Central time; supply it
    /// explicitly when back-filling or when a run could straddle midnight.
    /// </param>
    [HttpPost("quotes")]
    [RequestSizeLimit(BarchartIngestService.MaxPayloadBytes)]
    [ProducesResponseType(typeof(BarchartQuoteLoadResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartQuoteLoadResponse>> LoadQuotes(
        [FromQuery] DateOnly? snapshotDate = null, CancellationToken cancellationToken = default)
    {
        var json = await ReadBodyAsync(cancellationToken);
        return Ok(await _service.LoadQuotesAsync(json, snapshotDate, cancellationToken));
    }

    /// <summary>
    /// Returns the symbols to request quotes for, already grouped into batches — so the pipeline never
    /// has to track which instruments exist.
    /// </summary>
    [HttpGet("quote-batches")]
    [ProducesResponseType(typeof(List<BarchartQuoteBatchResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<BarchartQuoteBatchResponse>>> GetQuoteBatches(
        [FromQuery] int batchSize = 100, CancellationToken cancellationToken = default)
        => Ok(await _service.GetQuoteBatchesAsync(batchSize, cancellationToken));

    /// <summary>
    /// Publishes current feed prices onto the Bid Sheet for every location linked to the feed.
    /// Call this after a quote load. A manually entered bid is replaced only by a quote that is both
    /// current and newer than the edit; otherwise it is left alone.
    /// </summary>
    /// <param name="locationId">Limit to one Bid Sheet location; omit to process all linked locations.</param>
    /// <param name="instrumentType">Vendor price type to publish. Defaults to the flat cash bid.</param>
    [HttpPost("apply-bids")]
    [ProducesResponseType(typeof(BarchartApplyBidsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartApplyBidsResponse>> ApplyBids(
        [FromQuery] int? locationId = null,
        [FromQuery] string? instrumentType = "bidCash",
        CancellationToken cancellationToken = default)
        => Ok(await _service.ApplyBidsAsync(locationId, instrumentType, cancellationToken));

    /// <summary>
    /// Switches off catalog entries the vendor has stopped publishing. Run this only after a
    /// <em>complete</em> catalog sweep — a partial pull would deactivate instruments that still exist.
    /// Rows are flagged inactive, never deleted.
    /// </summary>
    /// <param name="lastSeenBefore">Deactivate instruments not seen since this UTC time.</param>
    /// <param name="maxSharePercent">
    /// Safety limit: the call is refused with a 400 if it would switch off more than this share of the
    /// active catalog. The sweep is sharded across several days, so a cutoff of "yesterday" would retire
    /// most of the book; raise this only when a large retirement is genuinely intended.
    /// </param>
    [HttpPost("deactivate-instruments")]
    [ProducesResponseType(typeof(BarchartDeactivateResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartDeactivateResponse>> DeactivateInstruments(
        [FromQuery] DateTime lastSeenBefore,
        [FromQuery] int maxSharePercent = BarchartIngestService.DefaultMaxDeactivationSharePercent,
        CancellationToken cancellationToken = default)
        => Ok(await _service.DeactivateInstrumentsAsync(lastSeenBefore, maxSharePercent, cancellationToken));

    /// <summary>
    /// Month-to-date ingest usage against the vendor's monthly call cap. The cap is shared across all
    /// environments because there is a single API key.
    /// </summary>
    [HttpGet("budget")]
    [ProducesResponseType(typeof(BarchartBudgetResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartBudgetResponse>> GetBudget(
        [FromQuery] int monthlyCap = 250_000, CancellationToken cancellationToken = default)
        => Ok(await _service.GetBudgetAsync(monthlyCap, cancellationToken));

    /// <summary>
    /// Trims the call audit and daily price history to their retention windows. Optional housekeeping —
    /// safe to call at the end of a run, or on any schedule. Deletes in batches, so a long-deferred
    /// purge trims steadily rather than locking the tables.
    /// </summary>
    /// <param name="auditRetentionDays">Keep audit rows newer than this (minimum 30).</param>
    /// <param name="snapshotRetentionDays">Keep price history newer than this (minimum 90).</param>
    [HttpPost("purge-history")]
    [ProducesResponseType(typeof(BarchartPurgeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BarchartPurgeResponse>> PurgeHistory(
        [FromQuery] int auditRetentionDays = 400,
        [FromQuery] int snapshotRetentionDays = 730,
        CancellationToken cancellationToken = default)
        => Ok(await _service.PurgeHistoryAsync(auditRetentionDays, snapshotRetentionDays, cancellationToken));

    /// <summary>
    /// Reads the request body as text. Deliberately not model-bound: vendor payloads carry fields we
    /// don't model and the application rejects unknown JSON members globally, so binding to a typed
    /// DTO would fail on any field BarChart adds. Field selection happens in the load SQL instead.
    /// </summary>
    private async Task<string> ReadBodyAsync(CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(Request.Body, System.Text.Encoding.UTF8);
        return await reader.ReadToEndAsync(cancellationToken);
    }
}
