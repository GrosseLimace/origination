// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class CustomersController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly IUserEntitlementService _entitlementService;

    public CustomersController(IDataService dataService, IUserEntitlementService entitlementService)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all customers, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Customer>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetCustomersAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Searches customers by name (max 15 results).</summary>
    [HttpGet("search")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Customer>>> Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Ok(await _dataService.GetCustomersAsync(tradeUnits, cancellationToken));
        }
        return Ok(await _dataService.SearchCustomersAsync(searchTerm, tradeUnits, cancellationToken));
    }

    /// <summary>
    /// Searches the ODS customer master for producers not yet onboarded into the app
    /// (no contract/ticket, so they never synced into dbo.Customer). Used as a home-page
    /// search fallback so a user can find and onboard them by assigning trade units.
    /// No trade-unit scoping — these producers have no TU yet, which is the whole point.
    /// </summary>
    [HttpGet("search-ods")]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Customer>>> SearchOds([FromQuery] string searchTerm, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
            return Ok(new List<Customer>());
        return Ok(await _dataService.SearchOdsCustomersAsync(searchTerm, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single customer by ID.</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Customer>> GetById(long id, CancellationToken cancellationToken = default)
    {
        var customer = await _dataService.GetCustomerByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Customer", id);
        return Ok(customer);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single customer by their source system ID (e.g. CTRM customer code).</summary>
    [HttpGet("by-source/{sourceId}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Customer>> GetBySourceId(string sourceId, CancellationToken cancellationToken = default)
    {
        var customer = await _dataService.GetCustomerByScoularIdAsync(sourceId, cancellationToken)
            ?? throw new NotFoundException("Customer", sourceId);
        return Ok(customer);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets customers whose ProducerDetails.LinkedProducerIds contains the given source id —
    /// i.e. customers that link TO this one (incoming / reverse links). Used by the cross-customer
    /// search path so the customer profile can show bidirectional linked producers even when no TU
    /// is selected.</summary>
    [HttpGet("linked-to/{sourceId}")]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Customer>>> GetLinkedTo(string sourceId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetCustomersLinkedToAsync(sourceId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing customer's contact and farm information.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Customer>> Update(long id, [FromBody] UpdateCustomerRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may act on any customer.
        var customer = await _dataService.GetCustomerByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Customer", id);

        await _dataService.UpdateCustomerAsync(
            id,
            request.Location ?? string.Empty,
            request.Phone ?? string.Empty,
            request.Email ?? string.Empty,
            request.FarmIds ?? new List<string>(),
            request.LinkedProducerIds ?? new List<string>(),
            cancellationToken
        );

        var updated = await _dataService.GetCustomerByIdAsync(id, cancellationToken);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Assigns trade units to a producer. Onboards them from the ODS into dbo.Customer
    /// if they aren't there yet (manual add, protected from the nightly sync). Used to
    /// surface producers who exist in CTRM but have no contract/ticket.
    /// </summary>
    [HttpPut("{id:long}/trade-units")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Customer>> AssignTradeUnits(long id, [FromBody] AssignTradeUnitsRequest request, CancellationToken cancellationToken = default)
    {
        var codes = request.TradeUnitCodes ?? new List<string>();
        var result = await _dataService.AssignTradeUnitsAsync(id, codes, cancellationToken);

        switch (result)
        {
            case AssignTradeUnitsResult.NoCodes:
                return BadRequest(new { message = "At least one trade unit code is required." });
            case AssignTradeUnitsResult.CustomerNotFound:
                throw new NotFoundException("Customer", id);
            default:
                var customer = await _dataService.GetCustomerByIdAsync(id, cancellationToken);
                return Ok(customer);
        }
    }
}
