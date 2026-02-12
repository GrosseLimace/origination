using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CustomersController : ControllerBase
{
    private readonly IDataService _dataService;

    public CustomersController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<Customer>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(_dataService.GetCustomers(tradeUnits));
    }

    [HttpGet("search")]
    public ActionResult<List<Customer>> Search([FromQuery] string searchTerm, [FromQuery] List<string>? tradeUnits = null)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Ok(_dataService.GetCustomers(tradeUnits));
        }
        return Ok(_dataService.SearchCustomers(searchTerm, tradeUnits));
    }

    [HttpGet("trade-units")]
    public ActionResult<List<string>> GetTradeUnits()
    {
        return Ok(_dataService.GetTradeUnits());
    }

    [HttpGet("{id:long}")]
    public ActionResult<Customer> GetById(long id)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null) return NotFound();
        return Ok(customer);
    }

    [HttpPut("{id:long}")]
    public ActionResult<Customer> Update(long id, [FromBody] Customer request)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null) return NotFound();

        // Update using the data service method (this ensures changes persist)
        _dataService.UpdateCustomer(
            id,
            request.Location,
            request.Phone,
            request.Email,
            request.FarmIds,
            request.LinkedProducerIds ?? new List<string>()
        );

        // Get the updated customer to return
        var updatedCustomer = _dataService.GetCustomerById(id);

        return Ok(updatedCustomer);
    }
}
