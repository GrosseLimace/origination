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
    /// <summary>Gets today's delivery tickets only, optionally filtered by trade units. Fast path for Spot Loads.</summary>
    [HttpGet("today")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetToday([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTodaysTicketsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetByCustomer(long customerId, [FromQuery] string? sourceCustomerId = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTicketsByCustomerAsync(customerId, sourceCustomerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        var tickets = await _dataService.GetTicketsByFarmAsync(farmId, cancellationToken);
        var tradeUnits = tickets.Select(t => t.OrganizationCode).Where(t => t is not null).Distinct().ToList();
        if (tradeUnits.Count > 0)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits!, cancellationToken);
        return Ok(tickets);
    }
}
