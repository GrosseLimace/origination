using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

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
    // Elevators (from dbo.ElevatorCache)
    // -------------------------------------------------------------------------

    /// <summary>Gets elevators for a trade unit. tradeUnitCode is required and validated against the
    /// caller's entitlements.</summary>
    [HttpGet("elevators")]
    [ProducesResponseType(typeof(List<ElevatorCacheResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<ElevatorCacheResponse>>> GetElevators([FromQuery] string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        // H-066 (2026-09-14): scoped, unlike the sibling locations read below. AR-05 covered both,
        // but its justification — the bid-sheet map needs every location — only ever applied to
        // locations. Nothing in the client calls this route, so requiring a scope costs no
        // behaviour. AR-05 was narrowed off it; do not re-open it to an unscoped read.
        //
        // Reject blank explicitly: ValidateTradeUnitsOrThrowAsync returns early on an empty set, so
        // `?tradeUnitCode=` would otherwise pass validation vacuously and fall through unscoped.
        if (string.IsNullOrWhiteSpace(tradeUnitCode))
            throw new ValidationException("tradeUnitCode", "tradeUnitCode is required.");

        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        return Ok(await _service.GetElevatorsAsync(tradeUnitCode, cancellationToken));
    }

    // -------------------------------------------------------------------------
    // Locations
    // -------------------------------------------------------------------------

    /// <summary>Gets bid sheet locations. If tradeUnitCode is provided, filters to that TU; otherwise returns all.</summary>
    [HttpGet("locations")]
    [ProducesResponseType(typeof(List<BidSheetLocationResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BidSheetLocationResponse>>> GetLocations([FromQuery] string? tradeUnitCode = null, CancellationToken cancellationToken = default)
    {
        // Reads are intentionally unscoped when tradeUnitCode is omitted (cross-TU visibility is a
        // feature; only writes are entitlement-gated). Accepted risk — see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-05).
        if (!string.IsNullOrWhiteSpace(tradeUnitCode))
            await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        return Ok(await _service.GetLocationsAsync(tradeUnitCode, cancellationToken));
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
    public async Task<IActionResult> DeleteLocation(int id, [FromQuery] string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        await _service.DeleteLocationAsync(id, cancellationToken);
        return NoContent();
    }

    /// <summary>Deletes all bids for a specific commodity on a location.</summary>
    [HttpDelete("locations/{id:int}/bids/{commodityCode}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteBids(int id, string commodityCode, [FromQuery] string tradeUnitCode, [FromQuery] int? month = null, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
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
        if (requests.Count > 500)
            return BadRequest("Maximum 500 bids per bulk request.");

        var tradeUnits = requests
            .Where(r => !string.IsNullOrEmpty(r.TradeUnitCode))
            .Select(r => r.TradeUnitCode!)
            .Distinct();
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits, cancellationToken);

        await _service.BulkUpsertBidsAsync(requests, cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    /// <summary>Gets distinct crop years from bids for a trade unit.</summary>
    [HttpGet("cropyears")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<int>>> GetCropYears([FromQuery] string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        return Ok(await _service.GetCropYearsAsync(tradeUnitCode, cancellationToken));
    }

    /// <summary>Gets distinct commodity codes from bids for a trade unit.</summary>
    [HttpGet("commodities")]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<string>>> GetBidCommodities([FromQuery] string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        return Ok(await _service.GetCommoditiesAsync(tradeUnitCode, cancellationToken));
    }

    /// <summary>Parses a composite trade-unit key ("2040,2050") into individual codes for entitlement validation.</summary>
    private static IEnumerable<string> ParseTradeUnitKey(string tradeUnitCode) =>
        tradeUnitCode.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // -------------------------------------------------------------------------
    // Bid Months
    // -------------------------------------------------------------------------

    /// <summary>Gets distinct months that have bids for a trade unit and crop year.</summary>
    [HttpGet("bidmonths")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<int>>> GetBidMonths([FromQuery] string tradeUnitCode, [FromQuery] int cropYear, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], cancellationToken);
        return Ok(await _service.GetBidMonthsAsync(tradeUnitCode, cropYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    // Location Order (drag-to-reorder persistence)
    // -------------------------------------------------------------------------

    /// <summary>Gets the saved location order for the current user and a trade unit key (may be composite).</summary>
    [HttpGet("location-order")]
    [ProducesResponseType(typeof(BidSheetLocationOrderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult<BidSheetLocationOrderResponse>> GetLocationOrder([FromQuery] string tradeUnitKey, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(ParseTradeUnitKey(tradeUnitKey), cancellationToken);
        var order = await _service.GetLocationOrderAsync(tradeUnitKey, cancellationToken);
        if (order is null) return NoContent();
        return Ok(order);
    }

    /// <summary>Saves the location order for the current user and a trade unit key.</summary>
    [HttpPut("location-order")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SetLocationOrder([FromBody] SetBidSheetLocationOrderRequest request, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(ParseTradeUnitKey(request.TradeUnitKey), cancellationToken);
        await _service.SetLocationOrderAsync(request.TradeUnitKey, request.LocationOrder, cancellationToken);
        return NoContent();
    }

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
        await _service.SetPreferenceAsync(request.TradeUnitKey, request.CropCode, request.Month, request.CropYear, request.CropOrder, request.HiddenCrops, request.SelectedMonths, request.PrintLayout, cancellationToken);
        return NoContent();
    }
}
