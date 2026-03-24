using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class BidSheetController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<BidSheetController> _logger;
    private readonly IUserEntitlementService _entitlementService;

    public BidSheetController(IDataService dataService, ILogger<BidSheetController> logger,
        IUserEntitlementService entitlementService)
    {
        _dataService = dataService;
        _logger = logger;
        _entitlementService = entitlementService;
    }

    private string CurrentUserId => User.FindFirst("preferred_username")?.Value
        ?? User.FindFirst("name")?.Value
        ?? throw new InvalidOperationException("User identity claims are missing.");

    // -------------------------------------------------------------------------
    // Elevators (from dbo.ElevatorCache)
    // -------------------------------------------------------------------------

    /// <summary>Gets elevators. If tradeUnitCode is omitted, returns all elevators.</summary>
    [HttpGet("elevators")]
    [ProducesResponseType(typeof(List<ElevatorCache>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ElevatorCache>>> GetElevators([FromQuery] string? tradeUnitCode = null, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(tradeUnitCode))
            await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetElevatorsAsync(tradeUnitCode, ct));
    }

    // -------------------------------------------------------------------------
    // Locations
    // -------------------------------------------------------------------------

    /// <summary>Gets all bid sheet locations (with nested bids) for a trade unit.</summary>
    [HttpGet("locations")]
    [ProducesResponseType(typeof(List<BidSheetLocation>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BidSheetLocation>>> GetLocations([FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidSheetLocationsAsync(tradeUnitCode, ct));
    }

    /// <summary>Creates a new bid sheet location with optional initial bids.</summary>
    [HttpPost("locations")]
    [ProducesResponseType(typeof(BidSheetLocation), StatusCodes.Status201Created)]
    public async Task<ActionResult<BidSheetLocation>> CreateLocation([FromBody] CreateBidSheetLocationRequest request, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], ct);

        var now = DateTime.UtcNow;
        var location = new BidSheetLocation
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            ElevatorCode = request.ElevatorCode,
            TradeUnitCode = request.TradeUnitCode,
            GroupName = request.GroupName,
            CreatedBy = CurrentUserId,
            CreatedAt = now,
            Bids = request.Bids.Select(b => new BidSheetLocationBid
            {
                CommodityCode = b.CommodityCode,
                CommodityName = b.CommodityName,
                CommodityCategory = b.CommodityCategory,
                CropYear = b.CropYear,
                Bid = b.Bid,
                CreatedBy = CurrentUserId,
                CreatedAt = now
            }).ToList()
        };

        var created = await _dataService.CreateBidSheetLocationAsync(location, ct);
        return Created("", created);
    }

    /// <summary>Updates location metadata (name, address, coordinates).</summary>
    [HttpPut("locations/{id:int}")]
    [ProducesResponseType(typeof(BidSheetLocation), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BidSheetLocation>> UpdateLocation(int id, [FromBody] CreateBidSheetLocationRequest request, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], ct);
        var location = new BidSheetLocation
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            ModifiedBy = CurrentUserId
        };

        var updated = await _dataService.UpdateBidSheetLocationAsync(id, location, ct);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    /// <summary>Deletes a bid sheet location and all its bids.</summary>
    [HttpDelete("locations/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteLocation(int id, [FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        await _dataService.DeleteBidSheetLocationAsync(id, ct);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Bids (bulk upsert for the edit-bids grid)
    // -------------------------------------------------------------------------

    /// <summary>Bulk upserts bids. Finds or creates locations, then upserts each bid by (location, commodity, cropYear).</summary>
    [HttpPost("bids/bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> BulkUpsertBids([FromBody] List<UpsertBidSheetBidRequest> requests, CancellationToken ct = default)
    {
        if (requests.Count > 500)
            return BadRequest("Maximum 500 bids per bulk request.");

        var tradeUnits = requests
            .Where(r => !string.IsNullOrEmpty(r.TradeUnitCode))
            .Select(r => r.TradeUnitCode!)
            .Distinct();
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits, ct);

        // Group by trade unit and process each
        var byTu = requests.GroupBy(r => r.TradeUnitCode ?? string.Empty);
        foreach (var group in byTu)
        {
            if (!string.IsNullOrEmpty(group.Key))
                await _dataService.BulkUpsertBidSheetBidsAsync(group, group.Key, CurrentUserId, ct);
        }

        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    /// <summary>Gets distinct crop years from bids for a trade unit.</summary>
    [HttpGet("cropyears")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<int>>> GetCropYears([FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidCropYearsAsync(tradeUnitCode, ct));
    }

    /// <summary>Gets distinct commodity codes from bids for a trade unit.</summary>
    [HttpGet("commodities")]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<string>>> GetBidCommodities([FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidCommoditiesAsync(tradeUnitCode, ct));
    }
}
