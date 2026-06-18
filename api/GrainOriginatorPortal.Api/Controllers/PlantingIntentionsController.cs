// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IPlantingIntentionService _service;
    private readonly ILogger<PlantingIntentionsController> _logger;

    public PlantingIntentionsController(IPlantingIntentionService service, ILogger<PlantingIntentionsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<PlantingIntentionResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntentionResponse>>> GetAll([FromQuery] string? tradeUnits = null, [FromQuery] int? plantingYear = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, plantingYear, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer. Open to any authenticated
    /// originator — trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:int}")]
    [ProducesResponseType(typeof(List<PlantingIntentionResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntentionResponse>>> GetByCustomer(int customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new planting intention for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntentionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PlantingIntentionResponse>> Create([FromBody] CreatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may create a planting intention
        // for any customer. The service derives the authoritative customer name/code/trade-unit and
        // throws a ValidationException (→ 400) when no trade unit can be determined.
        var intention = await _service.CreateAsync(
            request.CustomerId,
            request.CustomerName,
            request.CustomerCode,
            request.TradeUnit,
            request.Crop,
            request.Category,
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
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(PlantingIntentionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntentionResponse>> Update(int id, [FromBody] UpdatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may edit any planting intention.
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        var updated = await _service.UpdateAsync(
            id,
            request.Crop,
            request.Category,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear,
            cancellationToken
        ) ?? throw new NotFoundException("PlantingIntention", id);
        _logger.LogInformation(
            "Planting intention updated [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_UPDATE", "DataMutation", id);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a planting intention by ID.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any planting intention.
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        await _service.DeleteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Planting intention deleted [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
