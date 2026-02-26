using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

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
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear <= 0)
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
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear <= 0)
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
}

