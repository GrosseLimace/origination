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

        // Update the customer properties
        customer.Name = request.Name;
        customer.Farm = request.Farm;
        customer.Location = request.Location;
        customer.Phone = request.Phone;
        customer.Email = request.Email;
        customer.TotalAcres = request.TotalAcres;
        customer.FarmIds = request.FarmIds;
        customer.ESignEnabled = request.ESignEnabled;

        return Ok(customer);
    }
}
