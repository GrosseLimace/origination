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
    // Elevators (from dbo.ElevatorCache in Origination DB)
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
    // Bid Sheet Entries (user-added competitor locations + bids)
    // -------------------------------------------------------------------------

    /// <summary>Gets bid sheet entries for a trade unit, optionally filtered by year and commodity.</summary>
    [HttpGet("entries")]
    [ProducesResponseType(typeof(List<BidSheetEntry>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BidSheetEntry>>> GetEntries(
        [FromQuery] string tradeUnitCode,
        [FromQuery] int? cropYear = null,
        [FromQuery] string? commodityCode = null,
        CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidSheetEntriesAsync(tradeUnitCode, cropYear, commodityCode, ct));
    }

    /// <summary>Creates a new bid sheet entry.</summary>
    [HttpPost("entries")]
    [ProducesResponseType(typeof(BidSheetEntry), StatusCodes.Status201Created)]
    public async Task<ActionResult<BidSheetEntry>> CreateEntry([FromBody] CreateBidSheetEntryRequest request, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], ct);
        var entry = new BidSheetEntry
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            ElevatorCode = request.ElevatorCode,
            TradeUnitCode = request.TradeUnitCode,
            CommodityCode = request.CommodityCode,
            CommodityName = request.CommodityName,
            CommodityCategory = request.CommodityCategory,
            CropYear = request.CropYear,
            Bid = request.Bid,
            CreatedBy = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };

        var created = await _dataService.CreateBidSheetEntryAsync(entry, ct);
        return Created("", created);
    }

    /// <summary>Updates an existing bid sheet entry.</summary>
    [HttpPut("entries/{id:int}")]
    [ProducesResponseType(typeof(BidSheetEntry), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BidSheetEntry>> UpdateEntry(int id, [FromBody] CreateBidSheetEntryRequest request, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], ct);
        var entry = new BidSheetEntry
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            Bid = request.Bid,
            ModifiedBy = CurrentUserId
        };

        var updated = await _dataService.UpdateBidSheetEntryAsync(id, entry, ct);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    /// <summary>Deletes a bid sheet entry.</summary>
    [HttpDelete("entries/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteEntry(int id, [FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        await _dataService.DeleteBidSheetEntryAsync(id, ct);
        return NoContent();
    }

    /// <summary>Bulk creates bid sheet entries.</summary>
    [HttpPost("entries/bulk")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> BulkCreateEntries([FromBody] List<CreateBidSheetEntryRequest> requests, CancellationToken ct = default)
    {
        if (requests.Count > 500)
            return BadRequest("Maximum 500 entries per bulk request.");
        await _entitlementService.ValidateTradeUnitsOrThrowAsync(requests.Select(r => r.TradeUnitCode).Distinct(), ct);

        var entries = requests.Select(r => new BidSheetEntry
        {
            Name = r.Name,
            Address = r.Address,
            City = r.City,
            State = r.State,
            Latitude = r.Latitude,
            Longitude = r.Longitude,
            ElevatorCode = r.ElevatorCode,
            TradeUnitCode = r.TradeUnitCode,
            CommodityCode = r.CommodityCode,
            CommodityName = r.CommodityName,
            CommodityCategory = r.CommodityCategory,
            CropYear = r.CropYear,
            Bid = r.Bid,
            CreatedBy = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        }).ToList();

        await _dataService.BulkCreateBidSheetEntriesAsync(entries, ct);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    // Crop Years & Commodities
    // -------------------------------------------------------------------------

    /// <summary>Gets distinct crop years from bid sheet entries for a trade unit.</summary>
    [HttpGet("cropyears")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<int>>> GetCropYears([FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidCropYearsAsync(tradeUnitCode, ct));
    }

    /// <summary>Gets distinct commodity codes from bid sheet entries for a trade unit.</summary>
    [HttpGet("commodities")]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<string>>> GetBidCommodities([FromQuery] string tradeUnitCode, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        return Ok(await _dataService.GetBidCommoditiesAsync(tradeUnitCode, ct));
    }

    // -------------------------------------------------------------------------
    // Reference (per-user)
    // -------------------------------------------------------------------------

    /// <summary>Gets the user's reference elevator for a trade unit + commodity.</summary>
    [HttpGet("reference")]
    [ProducesResponseType(typeof(BidReference), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BidReference>> GetReference(
        [FromQuery] string tradeUnitCode,
        [FromQuery] string commodityCode,
        CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([tradeUnitCode], ct);
        var reference = await _dataService.GetBidReferenceAsync(CurrentUserId, tradeUnitCode, commodityCode, ct);
        if (reference == null) return NotFound();
        return Ok(reference);
    }

    /// <summary>Sets or updates the user's reference elevator.</summary>
    [HttpPut("reference")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SetReference([FromBody] SetBidReferenceRequest request, CancellationToken ct = default)
    {
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([request.TradeUnitCode], ct);
        var reference = new BidReference
        {
            UserId = CurrentUserId,
            TradeUnitCode = request.TradeUnitCode,
            CommodityCode = request.CommodityCode,
            ElevatorCode = request.ElevatorCode
        };

        await _dataService.SetBidReferenceAsync(reference, ct);
        return NoContent();
    }
}
