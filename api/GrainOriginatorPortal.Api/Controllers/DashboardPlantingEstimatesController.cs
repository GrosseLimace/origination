using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class DashboardPlantingEstimatesController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<DashboardPlantingEstimatesController> _logger;

    public DashboardPlantingEstimatesController(IDataService dataService, ILogger<DashboardPlantingEstimatesController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<DashboardPlantingEstimate>>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(await _dataService.GetDashboardPlantingEstimates(tradeUnitKey, plantingYear));
    }

    [HttpPost("upsert")]
    public async Task<ActionResult> Upsert([FromBody] List<UpsertDashboardEstimateRequest> estimates)
    {
        if (estimates == null || estimates.Count == 0) return BadRequest("No estimates provided.");
        var username = User.FindFirst("name")?.Value ?? User.Identity?.Name ?? "Unknown";
        await _dataService.UpsertDashboardPlantingEstimates(estimates, username);
        return NoContent();
    }

    [HttpGet("marketshares")]
    public async Task<ActionResult<List<DashboardMarketShare>>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(await _dataService.GetDashboardMarketShares(tradeUnitKey, plantingYear));
    }

    [HttpPost("marketshares/upsert")]
    public async Task<ActionResult> UpsertMarketShares([FromBody] List<UpsertDashboardMarketShareRequest> shares)
    {
        if (shares == null || shares.Count == 0) return BadRequest("No market shares provided.");
        var username = User.FindFirst("name")?.Value ?? User.Identity?.Name ?? "Unknown";
        await _dataService.UpsertDashboardMarketShares(shares, username);
        return NoContent();
    }

    [HttpGet("actualharvest")]
    public async Task<ActionResult<List<DashboardActualHarvest>>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(await _dataService.GetDashboardActualHarvest(tradeUnitKey, plantingYear));
    }

    [HttpPost("actualharvest/upsert")]
    public async Task<ActionResult> UpsertActualHarvest([FromBody] List<UpsertDashboardActualHarvestRequest> items)
    {
        if (items == null || items.Count == 0) return BadRequest("No harvest items provided.");
        var username = User.FindFirst("name")?.Value ?? User.Identity?.Name ?? "Unknown";
        await _dataService.UpsertDashboardActualHarvest(items, username);
        return NoContent();
    }

    [HttpDelete("actualharvest/{id:int}")]
    public async Task<ActionResult> DeleteActualHarvest(int id)
    {
        try
        {
            await _dataService.DeleteDashboardActualHarvest(id);
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting actual harvest record {Id}", id);
            return StatusCode(500, new { error = "An error occurred while deleting the harvest record." });
        }
    }
}

