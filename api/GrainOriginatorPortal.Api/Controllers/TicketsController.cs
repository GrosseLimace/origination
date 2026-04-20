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

    public TicketsController(IDataService dataService)
    {
        _dataService = dataService;
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
    /// <summary>Gets all delivery tickets for a specific farm. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Ticket>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTicketsByFarmAsync(farmId, cancellationToken));
    }
}
