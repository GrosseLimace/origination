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

    public DashboardPlantingEstimatesController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<DashboardPlantingEstimate>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(_dataService.GetDashboardPlantingEstimates(tradeUnitKey, plantingYear));
    }

    [HttpPost("upsert")]
    public ActionResult Upsert([FromBody] List<UpsertDashboardEstimateRequest> estimates)
    {
        if (estimates == null || estimates.Count == 0) return BadRequest("No estimates provided.");
        _dataService.UpsertDashboardPlantingEstimates(estimates, "system");
        return Ok();
    }

    [HttpGet("marketshares")]
    public ActionResult<List<DashboardMarketShare>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(_dataService.GetDashboardMarketShares(tradeUnitKey, plantingYear));
    }

    [HttpPost("marketshares/upsert")]
    public ActionResult UpsertMarketShares([FromBody] List<UpsertDashboardMarketShareRequest> shares)
    {
        if (shares == null || shares.Count == 0) return BadRequest("No market shares provided.");
        _dataService.UpsertDashboardMarketShares(shares, "system");
        return Ok();
    }

    [HttpGet("actualharvest")]
    public ActionResult<List<DashboardActualHarvest>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
            return BadRequest("tradeUnitKey and plantingYear are required.");
        return Ok(_dataService.GetDashboardActualHarvest(tradeUnitKey, plantingYear));
    }

    [HttpPost("actualharvest/upsert")]
    public ActionResult UpsertActualHarvest([FromBody] List<UpsertDashboardActualHarvestRequest> items)
    {
        if (items == null || items.Count == 0) return BadRequest("No harvest items provided.");
        _dataService.UpsertDashboardActualHarvest(items, "system");
        return Ok();
    }

    [HttpDelete("actualharvest/{id:int}")]
    public ActionResult DeleteActualHarvest(int id)
    {
        _dataService.DeleteDashboardActualHarvest(id);
        return Ok();
    }
}

