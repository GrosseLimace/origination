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
    public ActionResult<List<Customer>> GetAll()
    {
        return Ok(_dataService.GetCustomers());
    }

    [HttpGet("{id}")]
    public ActionResult<Customer> GetById(string id)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null) return NotFound();
        return Ok(customer);
    }

    [HttpPut("{id}")]
    public ActionResult<Customer> Update(string id, [FromBody] Customer request)
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
