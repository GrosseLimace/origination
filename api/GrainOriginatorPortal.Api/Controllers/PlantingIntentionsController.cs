// Project namespaces
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<PlantingIntentionsController> _logger;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ApplicationDbContext _appContext;

    public PlantingIntentionsController(IDataService dataService, ILogger<PlantingIntentionsController> logger, IUserEntitlementService entitlementService, ApplicationDbContext appContext)
    {
        _dataService = dataService;
        _logger = logger;
        _entitlementService = entitlementService;
        _appContext = appContext;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntention>>> GetAll(CancellationToken cancellationToken = default)
    {
        var intentions = await _dataService.GetPlantingIntentionsAsync(cancellationToken);
        if (_entitlementService.EntitlementsAvailable)
        {
            var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
            intentions = intentions.Where(i => string.IsNullOrEmpty(i.TradeUnit) || allowed.Contains(i.TradeUnit)).ToList();
        }
        return Ok(intentions);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer.</summary>
    [HttpGet("customer/{customerId}")]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<List<PlantingIntention>>> GetByCustomer(int customerId, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateCustomerAccessAsync(customerId, cancellationToken);
        return Ok(await _dataService.GetPlantingIntentionsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new planting intention for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PlantingIntention>> Create([FromBody] CreatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateCustomerAccessAsync(request.CustomerId, cancellationToken);

        // Derive customer metadata from the authoritative CustomerSnapshot rather than trusting
        // client-supplied values. This prevents callers from spoofing trade units or customer identity
        // to make records appear in unauthorized views.
        var snapshot = await _appContext.CustomerSnapshots
            .FirstOrDefaultAsync(cs => cs.CustomerId == request.CustomerId, cancellationToken);

        var customerName = snapshot?.CustomerName ?? request.CustomerName;
        var customerCode = snapshot?.SourceCustomerId ?? request.CustomerCode;
        var tradeUnit = snapshot?.TradeUnit ?? request.TradeUnit;

        var intention = await _dataService.AddPlantingIntentionAsync(
            request.CustomerId,
            customerName,
            customerCode,
            tradeUnit,
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntention>> Update(int id, [FromBody] UpdatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        var existing = await _dataService.GetPlantingIntentionByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        await _entitlementService.ValidateCustomerAccessAsync(existing.CustomerId, cancellationToken);
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        var intention = await _dataService.GetPlantingIntentionByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        await _entitlementService.ValidateCustomerAccessAsync(intention.CustomerId, cancellationToken);
        await _dataService.DeletePlantingIntentionAsync(id, cancellationToken);
        _logger.LogInformation(
            "Planting intention deleted [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
