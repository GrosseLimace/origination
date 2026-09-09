// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
[Authorize]
[EnforceTradeUnitAccess]
public class DashboardPlantingEstimatesController : ControllerBase
{
    private readonly IDashboardService _service;
    private readonly ILogger<DashboardPlantingEstimatesController> _logger;

    public DashboardPlantingEstimatesController(IDashboardService service, ILogger<DashboardPlantingEstimatesController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all three dashboard datasets (estimates, market shares, actual harvest) in a single request.</summary>
    [HttpGet("summary")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(DashboardSummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<DashboardSummaryResponse>> GetSummary([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
        return Ok(await _service.GetSummaryAsync(tradeUnitKey, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets planting estimates for a trade unit key and year.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<DashboardPlantingEstimateResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardPlantingEstimateResponse>>> Get([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
        return Ok(await _service.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken));
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
        await _service.UpsertPlantingEstimatesAsync(estimates, cancellationToken);
        _logger.LogInformation(
            "Dashboard planting estimates upserted [{ErrorCode}] [{ErrorCategory}]: Count={Count}",
            "AUDIT_UPSERT", "DataMutation", estimates.Count);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets market share percentages for a trade unit key and year.</summary>
    [HttpGet("marketshares")]
    [ProducesResponseType(typeof(List<DashboardMarketShareResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardMarketShareResponse>>> GetMarketShares([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
        return Ok(await _service.GetMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken));
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
        await _service.UpsertMarketSharesAsync(shares, cancellationToken);
        _logger.LogInformation(
            "Dashboard market shares upserted [{ErrorCode}] [{ErrorCategory}]: Count={Count}",
            "AUDIT_UPSERT", "DataMutation", shares.Count);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets actual harvest rows for a trade unit key and year.</summary>
    [HttpGet("actualharvest")]
    [ProducesResponseType(typeof(List<DashboardActualHarvestResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<DashboardActualHarvestResponse>>> GetActualHarvest([FromQuery] string tradeUnitKey, [FromQuery] int plantingYear, CancellationToken cancellationToken = default)
    {
        ValidateDashboardParams(tradeUnitKey, plantingYear);
        return Ok(await _service.GetActualHarvestAsync(tradeUnitKey, plantingYear, cancellationToken));
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
        await _service.UpsertActualHarvestAsync(items, cancellationToken);
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
        // The class-level [EnforceTradeUnitAccess] filter can only check a trade-unit value present on
        // the request, and this route carries none — so it validates nothing here. That is deliberate:
        // actual-harvest rows follow the shared-record delete model and a per-row trade-unit check was
        // drafted and reverted on purpose. See SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01, finding H-050).
        await _service.DeleteActualHarvestAsync(id, cancellationToken);
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
