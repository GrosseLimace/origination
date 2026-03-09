using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
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
    public async Task<ActionResult<List<Farm>>> GetAll()
    {
        return Ok(await _dataService.GetFarms());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<Farm>> GetById(string id)
    {
        var farm = await _dataService.GetFarmById(id);
        if (farm == null) return NotFound();
        return Ok(farm);
    }

    [HttpGet("customer/{customerId:long}")]
    public async Task<ActionResult<List<Farm>>> GetByCustomer(long customerId)
    {
        return Ok(await _dataService.GetFarmsByCustomer(customerId));
    }

    [HttpPost]
    public async Task<ActionResult<string>> Create([FromBody] CreateFarmRequest request)
    {
        var id = await _dataService.CreateFarm(request.Name, request.Location, request.Acres);
        return CreatedAtAction(nameof(GetById), new { id }, id);
    }
}

public class CreateFarmRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(200)]
    public string Location { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Range(1, 100000)]
    public int Acres { get; set; }
}
