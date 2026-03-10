namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DashboardPlantingEstimatesController : ControllerBase
{
    private readonly IDataService _dataService;

    public DashboardPlantingEstimatesController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets planting estimates for a trade unit key and year.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<DashboardPlantingEstimate>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<List<DashboardPlantingEstimate>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(_dataService.GetDashboardPlantingEstimates(tradeUnitKey, plantingYear));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts planting estimate yield values for a trade unit key and year.</summary>
    [HttpPost("upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult Upsert([FromBody] List<UpsertDashboardEstimateRequest> estimates)
    {
        if (estimates == null || estimates.Count == 0)
        {
            return BadRequest("No estimates provided.");
        }
        _dataService.UpsertDashboardPlantingEstimates(estimates, "system");
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets market share percentages for a trade unit key and year.</summary>
    [HttpGet("marketshares")]
    [ProducesResponseType(typeof(List<DashboardMarketShare>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<List<DashboardMarketShare>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(_dataService.GetDashboardMarketShares(tradeUnitKey, plantingYear));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts market share percentages for a trade unit key and year.</summary>
    [HttpPost("marketshares/upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult UpsertMarketShares([FromBody] List<UpsertDashboardMarketShareRequest> shares)
    {
        if (shares == null || shares.Count == 0)
        {
            return BadRequest("No market shares provided.");
        }
        _dataService.UpsertDashboardMarketShares(shares, "system");
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets actual harvest rows for a trade unit key and year.</summary>
    [HttpGet("actualharvest")]
    [ProducesResponseType(typeof(List<DashboardActualHarvest>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<List<DashboardActualHarvest>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(_dataService.GetDashboardActualHarvest(tradeUnitKey, plantingYear));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts actual harvest rows for a trade unit key and year.</summary>
    [HttpPost("actualharvest/upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult UpsertActualHarvest([FromBody] List<UpsertDashboardActualHarvestRequest> items)
    {
        if (items == null || items.Count == 0)
        {
            return BadRequest("No harvest items provided.");
        }
        _dataService.UpsertDashboardActualHarvest(items, "system");
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a single actual harvest row by ID.</summary>
    [HttpDelete("actualharvest/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult DeleteActualHarvest(int id)
    {
        _dataService.DeleteDashboardActualHarvest(id);
        return NoContent();
    }
}
