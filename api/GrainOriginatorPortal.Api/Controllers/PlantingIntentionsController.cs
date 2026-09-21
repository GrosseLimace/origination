// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IPlantingIntentionService _service;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<PlantingIntentionsController> _logger;

    public PlantingIntentionsController(IPlantingIntentionService service, IRequestContextService requestContext, ILogger<PlantingIntentionsController> logger)
    {
        _service = service;
        _requestContext = requestContext;
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
        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
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
        // for any customer. The service derives the authoritative customer name/code, keeps the chosen
        // trade unit when it is one of the producer's, and throws ValidationException (→ 400) otherwise.
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
            "Planting intention created [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}, CustomerId={CustomerId}, Crop={Crop}, TradeUnit={TradeUnit}, User={User}",
            "AUDIT_CREATE", "DataMutation", intention.Id, request.CustomerId, request.Crop, intention.TradeUnit, _requestContext.GetCurrentUser());
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
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
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
            request.TradeUnit,
            cancellationToken
        ) ?? throw new NotFoundException("PlantingIntention", id);
        _logger.LogInformation(
            "Planting intention updated [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}, TradeUnit={TradeUnit}, User={User}",
            "AUDIT_UPDATE", "DataMutation", id, updated.TradeUnit, _requestContext.GetCurrentUser());
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Moves all of a producer's planting intentions from one trade unit to another.
    /// Called when a producer is unassigned from a trade unit and the originator chooses where the
    /// acres should now count. Returns the number of rows moved.</summary>
    [HttpPost("retag")]
    [ProducesResponseType(typeof(RetagPlantingIntentionsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<RetagPlantingIntentionsResponse>> Retag([FromBody] RetagPlantingIntentionsRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary (AR-01/AR-02). The service still
        // refuses a target the producer doesn't trade with, which is a data-integrity rule.
        var moved = await _service.RetagAsync(request.CustomerId, request.FromTradeUnit, request.ToTradeUnit, cancellationToken);
        _logger.LogInformation(
            "Planting intentions retagged [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId}, From={From}, To={To}, Count={Count}",
            "AUDIT_UPDATE", "DataMutation", request.CustomerId, request.FromTradeUnit, request.ToTradeUnit, moved);
        return Ok(new RetagPlantingIntentionsResponse { Moved = moved });
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a planting intention by ID.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any planting intention.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        await _service.DeleteAsync(id, cancellationToken);
        // ⚠ This is a HARD delete — PlantingIntentionRepository.DeleteAsync calls Remove(), so the
        // row is gone and carries no DeletedBy. Unlike a note, there is nothing left to attribute
        // it to afterwards: THIS LOG LINE IS THE ONLY SURVIVING RECORD of who removed a forward
        // crop plan. M-043 (2026-09-21) credited this path with attribution it did not have — the
        // line recorded IntentionId and nothing else. Do not drop User from it.
        _logger.LogInformation(
            "Planting intention deleted [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}, User={User}",
            "AUDIT_DELETE", "DataMutation", id, _requestContext.GetCurrentUser());
        return NoContent();
    }
}
