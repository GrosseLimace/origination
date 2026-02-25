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
}

