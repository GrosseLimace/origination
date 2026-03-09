using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<ProducerDetailsController> _logger;

    public ProducerDetailsController(IDataService dataService, ILogger<ProducerDetailsController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<ProducerDetails>>> GetAll()
    {
        return Ok(await _dataService.GetAllProducerDetails());
    }

    [HttpGet("customer/{customerId:long}")]
    public async Task<ActionResult<ProducerDetails>> GetByCustomer(long customerId)
    {
        var details = await _dataService.GetProducerDetails(customerId);
        // Return empty record rather than 404 — absence of saved details is normal for new customers
        return Ok(details ?? new ProducerDetails { CustomerId = customerId });
    }

    [HttpPut("customer/{customerId:long}")]
    public async Task<ActionResult<ProducerDetails>> Upsert(long customerId, [FromBody] UpsertProducerDetailsRequest request)
    {
        try
        {
            var details = await _dataService.UpsertProducerDetails(
                customerId,
                request.SourceCustomerId,
                request.CustomerName,
                request.TotalAcres,
                request.BinCapacity,
                request.PrimaryContact,
                request.Commodities,
                request.LinkedProducerIds
            );
            return Ok(details);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving producer details for customer {CustomerId}", customerId);
            return StatusCode(500, new { error = "Failed to save producer details" });
        }
    }

    [HttpDelete("customer/{customerId:long}")]
    public async Task<ActionResult> Delete(long customerId)
    {
        await _dataService.DeleteProducerDetails(customerId);
        return NoContent();
    }
}

public class UpsertProducerDetailsRequest
{
    [System.ComponentModel.DataAnnotations.StringLength(50)]  public string? SourceCustomerId { get; set; }

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(255)] public string CustomerName { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Range(0, 999999)]  public decimal? TotalAcres { get; set; }
    [System.ComponentModel.DataAnnotations.Range(0, 999999)]  public decimal? BinCapacity { get; set; }
    [System.ComponentModel.DataAnnotations.StringLength(200)] public string? PrimaryContact { get; set; }
    [System.ComponentModel.DataAnnotations.StringLength(500)] public string? Commodities { get; set; }
    [System.ComponentModel.DataAnnotations.StringLength(500)] public string? LinkedProducerIds { get; set; }
}
