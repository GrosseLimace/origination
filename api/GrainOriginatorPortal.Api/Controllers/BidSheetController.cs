using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class BidSheetController : ControllerBase
{
    private readonly IBidSheetService _service;
    private readonly IUserEntitlementService _entitlementService;

    public BidSheetController(IBidSheetService service, IUserEntitlementService entitlementService)
    {
        _service = service;
        _entitlementService = entitlementService;
    }

    // -------------------------------------------------------------------------
    // Locations
    // -------------------------------------------------------------------------

    /// <summary>Gets every bid sheet location, with its bids.</summary>
    [HttpGet("locations")]
    [ProducesResponseType(typeof(List<BidSheetLocationResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BidSheetLocationResponse>>> GetLocations(CancellationToken cancellationToken = default)
    {
        // A location is company-wide, so this read is unscoped by design: everyone sees the same
        // catalog and a sheet decides what they work from. Only writes are entitlement-gated.
        // Accepted risk — see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-05).
        return Ok(await _service.GetLocationsAsync(cancellationToken));
    }

    /// <summary>Creates a new bid sheet location with optional initial bids.</summary>
    [HttpPost("locations")]
    [ProducesResponseType(typeof(BidSheetLocationResponse), StatusCodes.Status201Created)]
    public async Task<ActionResult<BidSheetLocationResponse>> CreateLocation([FromBody] CreateBidSheetLocationRequest request, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], cancellationToken);
        var created = await _service.CreateLocationAsync(request, cancellationToken);
        return Created("", created);
    }

    /// <summary>Updates location metadata (name, address, coordinates).</summary>
    [HttpPut("locations/{id:int}")]
    [ProducesResponseType(typeof(BidSheetLocationResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BidSheetLocationResponse>> UpdateLocation(int id, [FromBody] CreateBidSheetLocationRequest request, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], cancellationToken);
        var updated = await _service.UpdateLocationAsync(id, request, cancellationToken);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    /// <summary>Deletes a bid sheet location and all its bids.</summary>
    [HttpDelete("locations/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteLocation(int id, CancellationToken cancellationToken = default)
    {
        // No trade-unit entitlement check. It used to be here, but the trade unit on a location is
        // provenance now -- it names whichever desk first added the row, which is very often NOT the
        // caller. Validating it would 403 an originator for deleting a location somebody else added,
        // while the caller has to send the value it checks. Authorization moved into the service:
        // creator or Admin, checked against the persisted CreatedBy.
        await _service.DeleteLocationAsync(id, cancellationToken);
        return NoContent();
    }

    /// <summary>Deletes all bids for a specific commodity on a location.</summary>
    [HttpDelete("locations/{id:int}/bids/{commodityCode}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteBids(int id, string commodityCode, [FromQuery] int? month = null, CancellationToken cancellationToken = default)
    {
        // Authorization is the service guard (creator or Admin), not the row's provenance trade unit
        // -- see DeleteLocation above.
        await _service.DeleteBidsAsync(id, commodityCode, month, cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Bids (bulk upsert for the edit-bids grid)
    // -------------------------------------------------------------------------

    /// <summary>Bulk upserts bids. Finds or creates locations, then upserts each bid by (location, commodity, cropYear).</summary>
    [HttpPost("bids/bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> BulkUpsertBids([FromBody] List<UpsertBidSheetBidRequest> requests, CancellationToken cancellationToken = default)
    {
        // Thrown, not returned as a bare string — a raw JSON string body is unreadable to the
        // client's error unwrapping, so this message never reached the user.
        if (requests.Count > 500)
            throw new ValidationException(nameof(requests), "Maximum 500 bids per bulk request.");

        var tradeUnits = requests
            .Where(r => !string.IsNullOrEmpty(r.TradeUnitCode))
            .Select(r => r.TradeUnitCode!)
            .Distinct();
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits, cancellationToken);

        await _service.BulkUpsertBidsAsync(requests, cancellationToken);
        return NoContent();
    }

    /// <summary>Parses a composite trade-unit key ("2040,2050") into individual codes for entitlement validation.</summary>
    private static IEnumerable<string> ParseTradeUnitKey(string tradeUnitCode) =>
        tradeUnitCode.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // -------------------------------------------------------------------------
    // Bid Sheet Preferences (per-user per-TU UI preferences, e.g. selected crop)
    // -------------------------------------------------------------------------

    /// <summary>Special key for user's global (cross-TU) preference — skips TU entitlement validation.</summary>
    private const string GlobalPreferenceKey = "__global__";

    /// <summary>Gets the saved bid sheet preferences for the current user and a trade unit key (or global with "__global__").</summary>
    [HttpGet("preference")]
    [ProducesResponseType(typeof(BidSheetPreferenceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult<BidSheetPreferenceResponse>> GetPreference([FromQuery] string tradeUnitKey, CancellationToken cancellationToken = default)
    {
        if (tradeUnitKey != GlobalPreferenceKey)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(ParseTradeUnitKey(tradeUnitKey), cancellationToken);
        var pref = await _service.GetPreferenceAsync(tradeUnitKey, cancellationToken);
        if (pref is null) return NoContent();
        return Ok(pref);
    }

    /// <summary>Saves the bid sheet preferences for the current user and a trade unit key (or global with "__global__").</summary>
    [HttpPut("preference")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SetPreference([FromBody] SetBidSheetPreferenceRequest request, CancellationToken cancellationToken = default)
    {
        if (request.TradeUnitKey != GlobalPreferenceKey)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(ParseTradeUnitKey(request.TradeUnitKey), cancellationToken);
        await _service.SetPreferenceAsync(new BidSheetPreferenceUpdate
        {
            TradeUnitKey = request.TradeUnitKey,
            CropCode = request.CropCode,
            Month = request.Month,
            CropYear = request.CropYear,
            CropOrder = request.CropOrder,
            HiddenCrops = request.HiddenCrops,
            SelectedMonths = request.SelectedMonths,
            SelectedYears = request.SelectedYears,
            PrintLayout = request.PrintLayout,
            PriceMode = request.PriceMode,
            SelectedBidSheetIds = request.SelectedBidSheetIds
        }, cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Sheets
    //
    // A sheet is a named, shareable working set of locations -- what replaced the trade unit as the
    // thing that decides what the screen shows. No trade-unit entitlement checks anywhere below:
    // locations are company-wide, and the authorization boundary is the sheet itself (owner or
    // shared-with), enforced in the service against persisted values.
    // -------------------------------------------------------------------------

    /// <summary>Gets the sheets the current user owns or has been shared on.</summary>
    [HttpGet("sheets")]
    [ProducesResponseType(typeof(List<BidSheetResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BidSheetResponse>>> GetSheets(CancellationToken cancellationToken = default)
        => Ok(await _service.GetSheetsAsync(cancellationToken));

    /// <summary>Gets one sheet with its shares and locations. 403 if it exists but is not shared with you.</summary>
    [HttpGet("sheets/{sheetId:int}")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BidSheetResponse>> GetSheet(int sheetId, CancellationToken cancellationToken = default)
        => Ok(await _service.GetSheetAsync(sheetId, cancellationToken));

    /// <summary>Creates an empty sheet owned by the current user.</summary>
    [HttpPost("sheets")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<BidSheetResponse>> CreateSheet([FromBody] BidSheetRequest request, CancellationToken cancellationToken = default)
    {
        var created = await _service.CreateSheetAsync(request, cancellationToken);
        return CreatedAtAction(nameof(GetSheet), new { sheetId = created.Id }, created);
    }

    /// <summary>Renames a sheet. Owner only.</summary>
    [HttpPut("sheets/{sheetId:int}")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BidSheetResponse>> RenameSheet(int sheetId, [FromBody] BidSheetRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.RenameSheetAsync(sheetId, request, cancellationToken));

    /// <summary>Deletes a sheet, its shares and its location links. Owner only. The locations survive.</summary>
    [HttpDelete("sheets/{sheetId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DeleteSheet(int sheetId, CancellationToken cancellationToken = default)
    {
        await _service.DeleteSheetAsync(sheetId, cancellationToken);
        return NoContent();
    }

    /// <summary>Replaces who a sheet is shared with. Owner only. An empty list unshares it.</summary>
    [HttpPut("sheets/{sheetId:int}/shares")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<BidSheetResponse>> SetSheetShares(int sheetId, [FromBody] BidSheetSharesRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.SetSheetSharesAsync(sheetId, request, cancellationToken));

    /// <summary>Saves the sheet's shared column layout. Any member.</summary>
    [HttpPut("sheets/{sheetId:int}/layout")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> SetSheetLayout(int sheetId, [FromBody] BidSheetLayoutRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.SetSheetLayoutAsync(sheetId, request, cancellationToken));

    /// <summary>Puts an existing location on the sheet. Idempotent. Any member.</summary>
    [HttpPost("sheets/{sheetId:int}/locations")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> AddSheetLocation(int sheetId, [FromBody] AddBidSheetLocationRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.AddSheetLocationAsync(sheetId, request, cancellationToken));

    /// <summary>Takes a location off the sheet. The location itself is untouched. Any member.</summary>
    [HttpDelete("sheets/{sheetId:int}/locations/{locationId:int}")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> RemoveSheetLocation(int sheetId, int locationId, CancellationToken cancellationToken = default)
        => Ok(await _service.RemoveSheetLocationAsync(sheetId, locationId, cancellationToken));

    /// <summary>
    /// Takes several locations off the sheet in one go. Any member.
    /// </summary>
    /// <remarks>
    /// PUT with a body rather than DELETE: a multi-select needs a list, and DELETE-with-body is poorly
    /// supported across proxies. One transaction, so a batch cannot half-apply. The locations survive —
    /// deleting an elevator outright is a different endpoint with a different, stricter guard.
    /// </remarks>
    [HttpPut("sheets/{sheetId:int}/locations/remove")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> RemoveSheetLocations(int sheetId, [FromBody] BidSheetRemoveLocationsRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.RemoveSheetLocationsAsync(sheetId, request, cancellationToken));

    /// <summary>
    /// Renames a location ON THIS SHEET only. Any member.
    /// </summary>
    /// <remarks>
    /// Deliberately separate from PUT locations/{id}, which writes the shared row. Locations are
    /// company-wide, so that endpoint's rename hit every sheet holding the elevator, last-write-wins:
    /// two originators with the same elevator overwrote each other's label. This writes the sheet's own
    /// display name and leaves the canonical row -- and the BarChart bridge's match on it -- alone.
    /// </remarks>
    [HttpPut("sheets/{sheetId:int}/locations/{locationId:int}/name")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> SetSheetLocationName(int sheetId, int locationId, [FromBody] BidSheetLocationNameRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.SetSheetLocationNameAsync(sheetId, locationId, request, cancellationToken));

    /// <summary>Saves the shared row order for the sheet. Any member.</summary>
    [HttpPut("sheets/{sheetId:int}/location-order")]
    [ProducesResponseType(typeof(BidSheetResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BidSheetResponse>> SetSheetLocationOrder(int sheetId, [FromBody] BidSheetLocationOrderRequest request, CancellationToken cancellationToken = default)
        => Ok(await _service.SetSheetLocationOrderAsync(sheetId, request, cancellationToken));

    /// <summary>
    /// How many sheets hold this location. The delete confirmation says the number out loud, because
    /// a location is company-wide now and deleting one takes it off everybody else's sheet too.
    /// </summary>
    [HttpGet("locations/{id:int}/sheet-count")]
    [ProducesResponseType(typeof(int), StatusCodes.Status200OK)]
    public async Task<ActionResult<int>> GetLocationSheetCount(int id, CancellationToken cancellationToken = default)
        => Ok(await _service.CountSheetsHoldingLocationAsync(id, cancellationToken));
}
