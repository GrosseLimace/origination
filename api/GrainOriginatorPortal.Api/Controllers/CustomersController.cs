using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class CustomersController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<CustomersController> _logger;

    public CustomersController(IDataService dataService, ILogger<CustomersController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<Customer>>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(await _dataService.GetCustomers(tradeUnits));
    }

    [HttpGet("search")]
    public async Task<ActionResult<List<Customer>>> Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Ok(await _dataService.GetCustomers(tradeUnits));
        }
        return Ok(await _dataService.SearchCustomers(searchTerm, tradeUnits));
    }

    [HttpGet("trade-units")]
    public async Task<ActionResult<List<string>>> GetTradeUnits()
    {
        return Ok(await _dataService.GetTradeUnits());
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<Customer>> GetById(long id)
    {
        var customer = await _dataService.GetCustomerById(id);
        if (customer == null) return NotFound();
        return Ok(customer);
    }

    [HttpPut("{id:long}")]
    public async Task<ActionResult<Customer>> Update(long id, [FromBody] UpdateCustomerRequest request)
    {
        try
        {
            var customer = await _dataService.GetCustomerById(id);
            if (customer == null) return NotFound();

            await _dataService.UpdateCustomer(
                id,
                request.Location ?? string.Empty,
                request.Phone ?? string.Empty,
                request.Email ?? string.Empty,
                request.FarmIds,
                request.LinkedProducerIds ?? new List<string>()
            );

            var updatedCustomer = await _dataService.GetCustomerById(id);
            return Ok(updatedCustomer);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating customer {CustomerId}", id);
            return StatusCode(500, new { error = "An error occurred while updating the customer." });
        }
    }
}
