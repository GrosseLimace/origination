using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<PlantingIntentionsController> _logger;

    public PlantingIntentionsController(IDataService dataService, ILogger<PlantingIntentionsController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public ActionResult<List<PlantingIntention>> GetAll()
    {
        return Ok(_dataService.GetPlantingIntentions());
    }

    [HttpGet("customer/{customerId}")]
    public ActionResult<List<PlantingIntention>> GetByCustomer(int customerId)
    {
        return Ok(_dataService.GetPlantingIntentionsByCustomer(customerId));
    }

    [HttpPost]
    public ActionResult Create([FromBody] CreatePlantingIntentionRequest request)
    {
        var newIntention = _dataService.AddPlantingIntention(
            request.CustomerId,
            request.CustomerName,
            request.CustomerCode,
            request.TradeUnit,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear
        );
        return Ok(newIntention);
    }

    [HttpPut("{id}")]
    public ActionResult Update(int id, [FromBody] UpdatePlantingIntentionRequest request)
    {
        var updatedIntention = _dataService.UpdatePlantingIntention(
            id,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear
        );
        if (updatedIntention == null) return NotFound();
        return Ok(updatedIntention);
    }

    [HttpDelete("{id}")]
    public ActionResult Delete(int id)
    {
        try
        {
            _dataService.DeletePlantingIntention(id);
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting planting intention {Id}", id);
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }
}

public class CreatePlantingIntentionRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    public int CustomerId { get; set; }

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(255)]
    public string CustomerName { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(50)]
    public string CustomerCode { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string TradeUnit { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string Crop { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string? Type { get; set; }

    [System.ComponentModel.DataAnnotations.StringLength(255)]
    public string? Description { get; set; }

    [System.ComponentModel.DataAnnotations.Range(1, 100000)]
    public int Acres { get; set; }

    [System.ComponentModel.DataAnnotations.Range(2020, 2100)]
    public int PlantingYear { get; set; }
}

public class UpdatePlantingIntentionRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string Crop { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string? Type { get; set; }

    [System.ComponentModel.DataAnnotations.StringLength(255)]
    public string? Description { get; set; }

    [System.ComponentModel.DataAnnotations.Range(1, 100000)]
    public int Acres { get; set; }

    [System.ComponentModel.DataAnnotations.Range(2020, 2100)]
    public int PlantingYear { get; set; }
}
