// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CustomersController : ControllerBase
{
    private readonly IDataService _dataService;

    public CustomersController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all customers, optionally filtered by trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Customer>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetCustomersAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Searches customers by name (max 15 results).</summary>
    [HttpGet("search")]
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
    /// <summary>Updates an existing customer's contact and farm information.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Customer>> Update(long id, [FromBody] Customer request, CancellationToken cancellationToken = default)
    {
        var customer = await _dataService.GetCustomerByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Customer", id);

        await _dataService.UpdateCustomerAsync(
            id,
            request.Location ?? string.Empty,
            request.Phone ?? string.Empty,
            request.Email ?? string.Empty,
            request.FarmIds,
            request.LinkedProducerIds ?? new List<string>(),
            cancellationToken
        );

        var updated = await _dataService.GetCustomerByIdAsync(id, cancellationToken);
        return Ok(updated);
    }
}
