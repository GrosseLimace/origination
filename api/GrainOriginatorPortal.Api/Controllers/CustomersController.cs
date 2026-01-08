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
    public ActionResult Update(string id, [FromBody] UpdateCustomerRequest request)
    {
        var customer = _dataService.GetCustomerById(id);
        if (customer == null) return NotFound();

        _dataService.UpdateCustomer(id, request.Location, request.Phone, request.Email, request.FarmIds);
        return NoContent();
    }
}

public class UpdateCustomerRequest
{
    public string Location { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public List<string> FarmIds { get; set; } = new();
}
