namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
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
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public ActionResult<List<Ticket>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(_dataService.GetTickets(tradeUnits));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public ActionResult<List<Ticket>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetTicketsByCustomer(customerId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Ticket>), StatusCodes.Status200OK)]
    public ActionResult<List<Ticket>> GetByFarm(string farmId)
    {
        return Ok(_dataService.GetTicketsByFarm(farmId));
    }
}
