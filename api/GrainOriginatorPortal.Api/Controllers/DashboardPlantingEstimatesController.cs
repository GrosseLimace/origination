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
    public async Task<ActionResult<List<DashboardPlantingEstimate>>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(await _dataService.GetDashboardPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts planting estimate yield values for a trade unit key and year.</summary>
    [HttpPost("upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult> Upsert([FromBody] List<UpsertDashboardEstimateRequest> estimates, CancellationToken cancellationToken = default)
    {
        if (estimates == null || estimates.Count == 0)
        {
            return BadRequest("No estimates provided.");
        }
        await _dataService.UpsertDashboardPlantingEstimatesAsync(estimates, "system", cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets market share percentages for a trade unit key and year.</summary>
    [HttpGet("marketshares")]
    [ProducesResponseType(typeof(List<DashboardMarketShare>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardMarketShare>>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(await _dataService.GetDashboardMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts market share percentages for a trade unit key and year.</summary>
    [HttpPost("marketshares/upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult> UpsertMarketShares([FromBody] List<UpsertDashboardMarketShareRequest> shares, CancellationToken cancellationToken = default)
    {
        if (shares == null || shares.Count == 0)
        {
            return BadRequest("No market shares provided.");
        }
        await _dataService.UpsertDashboardMarketSharesAsync(shares, "system", cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets actual harvest rows for a trade unit key and year.</summary>
    [HttpGet("actualharvest")]
    [ProducesResponseType(typeof(List<DashboardActualHarvest>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardActualHarvest>>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(tradeUnitKey) || plantingYear < 2020 || plantingYear > DateTime.Now.Year + 5)
        {
            return BadRequest("tradeUnitKey and plantingYear are required.");
        }
        return Ok(await _dataService.GetDashboardActualHarvestAsync(tradeUnitKey, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Upserts actual harvest rows for a trade unit key and year.</summary>
    [HttpPost("actualharvest/upsert")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult> UpsertActualHarvest([FromBody] List<UpsertDashboardActualHarvestRequest> items, CancellationToken cancellationToken = default)
    {
        if (items == null || items.Count == 0)
        {
            return BadRequest("No harvest items provided.");
        }
        await _dataService.UpsertDashboardActualHarvestAsync(items, "system", cancellationToken);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a single actual harvest row by ID.</summary>
    [HttpDelete("actualharvest/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> DeleteActualHarvest(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteDashboardActualHarvestAsync(id, cancellationToken);
        return NoContent();
    }
}
