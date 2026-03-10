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
    public ActionResult<List<Customer>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(_dataService.GetCustomers(tradeUnits));
    }

    // -------------------------------------------------------------------------
    /// <summary>Searches customers by name (max 15 results).</summary>
    [HttpGet("search")]
    [ProducesResponseType(typeof(List<Customer>), StatusCodes.Status200OK)]
    public ActionResult<List<Customer>> Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Ok(_dataService.GetCustomers(tradeUnits));
        }
        return Ok(_dataService.SearchCustomers(searchTerm, tradeUnits));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all unique trade unit codes.</summary>
    [HttpGet("trade-units")]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public ActionResult<List<string>> GetTradeUnits()
    {
        return Ok(_dataService.GetTradeUnits());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single customer by ID.</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<Customer> GetById(long id)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null)
        {
            return NotFound();
        }
        return Ok(customer);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing customer's contact and farm information.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(Customer), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<Customer> Update(long id, [FromBody] Customer request)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null)
        {
            return NotFound();
        }

        _dataService.UpdateCustomer(
            id,
            request.Location ?? string.Empty,
            request.Phone ?? string.Empty,
            request.Email ?? string.Empty,
            request.FarmIds,
            request.LinkedProducerIds ?? new List<string>()
        );

        var updated = _dataService.GetCustomerById(id);
        return Ok(updated);
    }
}
