using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class TicketsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly IUserEntitlementService _entitlementService;

    public TicketsController(IDataService dataService, IUserEntitlementService entitlementService)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTicketsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateCustomerAccessAsync(customerId, cancellationToken);
        return Ok(await _dataService.GetTicketsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTicketsByFarmAsync(farmId, cancellationToken));
    }
}
