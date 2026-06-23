using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class TicketsController : ControllerBase
{
    private readonly ITicketService _service;

    public TicketsController(ITicketService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets today's delivery tickets only, optionally filtered by trade units. Fast path for Spot Loads.</summary>
    [HttpGet("today")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetToday([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetTodaysAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetByCustomer(long customerId, [FromQuery] string? scoularId = null, CancellationToken cancellationToken = default)
    {
        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetByCustomerAsync(customerId, scoularId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Fast per-producer unapplied-tickets fetch. Single CustomerCode predicate, used by the
    /// home page on producer select. Applied tickets load lazily per-contract on row expansion.</summary>
    [HttpGet("customer/{customerId:long}/unapplied")]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetUnappliedByCustomer(long customerId, [FromQuery] string? scoularId = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetUnappliedByCustomerAsync(customerId, scoularId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Lazy per-contract applied-tickets fetch. Single-literal predicate on ContractNumber.
    /// Used by the contracts table when a row is expanded. The sourceContractId can contain spaces
    /// (e.g. "PC  13042"), so callers must URL-encode it.</summary>
    [HttpGet("contract/{sourceContractId}/applied")]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetAppliedByContract(string sourceContractId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAppliedByContractAsync(sourceContractId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all delivery tickets for a specific farm. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<TicketResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TicketResponse>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByFarmAsync(farmId, cancellationToken));
    }
}
