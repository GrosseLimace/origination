// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
[Authorize]
[EnforceTradeUnitAccess]
public class DashboardPlantingEstimatesController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<DashboardPlantingEstimatesController> _logger;

    public DashboardPlantingEstimatesController(IDataService dataService, ILogger<DashboardPlantingEstimatesController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    // Resolve the authenticated user's identity for audit trail in upsert operations.
    // security-guide.md §8.1: administrative actions must be attributable to a specific user.
    private string CurrentUserId =>
        User.FindFirst("preferred_username")?.Value
        ?? User.FindFirst("oid")?.Value
        ?? User.Identity?.Name
        ?? "unknown";

    // -------------------------------------------------------------------------
    /// <summary>Gets all three dashboard datasets (estimates, market shares, actual harvest) in a single request.</summary>
    [HttpGet("summary")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(DashboardSummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<DashboardSummaryResponse>> GetSummary([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
        return Ok(await _dataService.GetDashboardSummaryAsync(tradeUnitKey, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets planting estimates for a trade unit key and year.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<DashboardPlantingEstimate>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardPlantingEstimate>>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
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
            throw new ValidationException("estimates", "At least one estimate must be provided.");
        }
        await _dataService.UpsertDashboardPlantingEstimatesAsync(estimates, CurrentUserId, cancellationToken);
        _logger.LogInformation(
            "Dashboard planting estimates upserted [{ErrorCode}] [{ErrorCategory}]: Count={Count}",
            "AUDIT_UPSERT", "DataMutation", estimates.Count);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets market share percentages for a trade unit key and year.</summary>
    [HttpGet("marketshares")]
    [ProducesResponseType(typeof(List<DashboardMarketShare>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardMarketShare>>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
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
            throw new ValidationException("shares", "At least one market share must be provided.");
        }
        await _dataService.UpsertDashboardMarketSharesAsync(shares, CurrentUserId, cancellationToken);
        _logger.LogInformation(
            "Dashboard market shares upserted [{ErrorCode}] [{ErrorCategory}]: Count={Count}",
            "AUDIT_UPSERT", "DataMutation", shares.Count);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets actual harvest rows for a trade unit key and year.</summary>
    [HttpGet("actualharvest")]
    [ProducesResponseType(typeof(List<DashboardActualHarvest>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardActualHarvest>>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
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
            throw new ValidationException("items", "At least one harvest item must be provided.");
        }
        await _dataService.UpsertDashboardActualHarvestAsync(items, CurrentUserId, cancellationToken);
        _logger.LogInformation(
            "Dashboard actual harvest upserted [{ErrorCode}] [{ErrorCategory}]: Count={Count}",
            "AUDIT_UPSERT", "DataMutation", items.Count);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a single actual harvest row by ID.</summary>
    [HttpDelete("actualharvest/{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> DeleteActualHarvest(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteDashboardActualHarvestAsync(id, cancellationToken);
        _logger.LogInformation(
            "Dashboard actual harvest deleted [{ErrorCode}] [{ErrorCategory}]: HarvestId={HarvestId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    private static void ValidateDashboardParams(string tradeUnitKey, int plantingYear)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(tradeUnitKey))
        {
            errors["tradeUnitKey"] = ["tradeUnitKey is required."];
        }

        var maxYear = DateTime.Now.Year + 5;
        if (plantingYear < 2020 || plantingYear > maxYear)
        {
            errors["plantingYear"] = [$"plantingYear must be between 2020 and {maxYear}."];
        }

        if (errors.Count > 0)
        {
            throw new Exceptions.ValidationException(errors);
        }
    }
}
