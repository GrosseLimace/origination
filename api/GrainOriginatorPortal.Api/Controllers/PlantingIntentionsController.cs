using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IDataService _dataService;

    public PlantingIntentionsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<PlantingIntention>> GetAll()
    {
        return Ok(_dataService.GetPlantingIntentions());
    }

    [HttpGet("customer/{customerId}")]
    public ActionResult<List<PlantingIntention>> GetByCustomer(string customerId)
    {
        return Ok(_dataService.GetPlantingIntentionsByCustomer(customerId));
    }

    [HttpPost]
    public ActionResult Create([FromBody] CreatePlantingIntentionRequest request)
    {
        _dataService.AddPlantingIntention(
            request.CustomerId,
            request.FarmId,
            request.Crop,
            request.Acres,
            request.Variety,
            request.PlantingDate,
            request.EstimatedYield
        );
        return Created();
    }

    [HttpPut("{id}")]
    public ActionResult Update(string id, [FromBody] UpdatePlantingIntentionRequest request)
    {
        _dataService.UpdatePlantingIntention(
            id,
            request.Crop,
            request.Acres,
            request.Variety,
            request.PlantingDate,
            request.EstimatedYield
        );
        return NoContent();
    }
}

public class CreatePlantingIntentionRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string CustomerId { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string FarmId { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(50)]
    public string Crop { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Range(1, 100000)]
    public int Acres { get; set; }

    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string Variety { get; set; } = string.Empty;

    public DateTime PlantingDate { get; set; }

    [System.ComponentModel.DataAnnotations.Range(1, 500)]
    public int EstimatedYield { get; set; }
}

public class UpdatePlantingIntentionRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(50)]
    public string Crop { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Range(1, 100000)]
    public int Acres { get; set; }

    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string Variety { get; set; } = string.Empty;

    public DateTime PlantingDate { get; set; }

    [System.ComponentModel.DataAnnotations.Range(1, 500)]
    public int EstimatedYield { get; set; }
}
