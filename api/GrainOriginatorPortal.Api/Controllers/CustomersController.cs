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

    // -------------------------------------------------------------------------
    /// <summary>Gets all unique trade unit codes.</summary>
    [HttpGet("trade-units")]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<string>>> GetTradeUnits(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetTradeUnitsAsync(cancellationToken));
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
        await _entitlementService.ValidateCustomerAccessAsync(id, cancellationToken);
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
}
