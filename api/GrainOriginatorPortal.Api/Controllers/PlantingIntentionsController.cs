// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
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
    public async Task<ActionResult<List<PlantingIntention>>> GetAll([FromQuery] string? tradeUnits = null, [FromQuery] int? plantingYear = null, CancellationToken cancellationToken = default)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var intentions = await _dataService.GetPlantingIntentionsAsync(tuList, plantingYear, cancellationToken);
        if (_entitlementService.EntitlementsAvailable)
        {
            var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
            intentions = intentions.Where(i => string.IsNullOrEmpty(i.TradeUnit) || allowed.Contains(i.TradeUnit)).ToList();
        }
        return Ok(intentions);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer. Open to any authenticated
    /// originator — trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:int}")]
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PlantingIntention>> Create([FromBody] CreatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may create a planting intention for any customer.

        // Derive customer metadata from the authoritative dbo.Customer rather than trusting
        // client-supplied values. This prevents callers from spoofing trade units or customer identity
        // to make records appear in unauthorized views. TradeUnit comes from dbo.CustomerTradeUnit
        // (picks the first active TU for this customer if multiple — matches prior behavior).
        var customer = await _appContext.Customers
            .FirstOrDefaultAsync(c => c.Id == request.CustomerId, cancellationToken);
        var customerTU = await _appContext.CustomerTradeUnits
            .Where(ctu => ctu.CustomerId == request.CustomerId && ctu.IsActive)
            .Select(ctu => ctu.TradeUnit)
            .FirstOrDefaultAsync(cancellationToken);

        var customerName = customer?.Name ?? request.CustomerName ?? string.Empty;
        var customerCode = customer?.ScoularId ?? request.CustomerCode ?? string.Empty;
        var tradeUnit = customerTU ?? request.TradeUnit;

        if (string.IsNullOrWhiteSpace(tradeUnit))
            return BadRequest("Trade unit could not be determined for this customer. Please select a trade unit and try again.");

        var intention = await _dataService.AddPlantingIntentionAsync(
            request.CustomerId,
            customerName,
            customerCode,
            tradeUnit,
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
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntention>> Update(int id, [FromBody] UpdatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may edit any planting intention.
        _ = await _dataService.GetPlantingIntentionByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        var updated = await _dataService.UpdatePlantingIntentionAsync(
            id,
            request.Crop,
            request.Category,
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
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any planting intention.
        _ = await _dataService.GetPlantingIntentionByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", id);
        await _dataService.DeletePlantingIntentionAsync(id, cancellationToken);
        _logger.LogInformation(
            "Planting intention deleted [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
