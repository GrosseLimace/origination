using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FarmsController : ControllerBase
{
    private readonly IDataService _dataService;

    public FarmsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<Farm>> GetAll()
    {
        return Ok(_dataService.GetFarms());
    }

    [HttpGet("{id}")]
    public ActionResult<Farm> GetById(string id)
    {
        var farm = _dataService.GetFarmById(id);
        if (farm == null) return NotFound();
        return Ok(farm);
    }

    [HttpGet("customer/{customerId}")]
    public ActionResult<List<Farm>> GetByCustomer(string customerId)
    {
        return Ok(_dataService.GetFarmsByCustomer(customerId));
    }

    [HttpPost]
    public ActionResult<string> Create([FromBody] CreateFarmRequest request)
    {
        var id = _dataService.CreateFarm(request.Name, request.Location, request.Acres);
        return CreatedAtAction(nameof(GetById), new { id }, id);
    }
}

public class CreateFarmRequest
{
    public string Name { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public int Acres { get; set; }
}
