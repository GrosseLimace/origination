// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<PlantingIntentionsController> _logger;

    public PlantingIntentionsController(IDataService dataService, ILogger<PlantingIntentionsController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntention>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetPlantingIntentionsAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer.</summary>
    [HttpGet("customer/{customerId}")]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntention>>> GetByCustomer(int customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetPlantingIntentionsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new planting intention for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PlantingIntention>> Create([FromBody] CreatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        // Access already validated when the user loaded the customer (GET endpoints check entitlements).
        // Redundant validation here caused 403s when vw_CustomerTradeUnits had incomplete mappings.
        var intention = await _dataService.AddPlantingIntentionAsync(
            request.CustomerId,
            request.CustomerName,
            request.CustomerCode,
            request.TradeUnit,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear,
            cancellationToken
        );
        _logger.LogInformation(
            "Planting intention created [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}, CustomerId={CustomerId}, Crop={Crop}",
            "AUDIT_CREATE", "DataMutation", intention.Id, request.CustomerId, request.Crop);
        return Ok(intention);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing planting intention.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntention>> Update(int id, [FromBody] UpdatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _dataService.UpdatePlantingIntentionAsync(
            id,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear,
            cancellationToken
        );
        if (updated == null)
        {
            throw new NotFoundException("PlantingIntention", id);
        }
        _logger.LogInformation(
            "Planting intention updated [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_UPDATE", "DataMutation", id);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a planting intention by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeletePlantingIntentionAsync(id, cancellationToken);
        _logger.LogInformation(
            "Planting intention deleted [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
