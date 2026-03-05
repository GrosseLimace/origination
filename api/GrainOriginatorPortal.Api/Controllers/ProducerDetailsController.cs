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
    public ActionResult<List<ProducerDetails>> GetAll()
    {
        return Ok(_dataService.GetAllProducerDetails());
    }

    [HttpGet("customer/{customerId:long}")]
    public ActionResult<ProducerDetails> GetByCustomer(long customerId)
    {
        var details = _dataService.GetProducerDetails(customerId);
        // Return empty record rather than 404 — absence of saved details is normal for new customers
        return Ok(details ?? new ProducerDetails { CustomerId = customerId });
    }

    [HttpPut("customer/{customerId:long}")]
    public ActionResult<ProducerDetails> Upsert(long customerId, [FromBody] UpsertProducerDetailsRequest request)
    {
        try
        {
            var details = _dataService.UpsertProducerDetails(
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
    public ActionResult Delete(long customerId)
    {
        _dataService.DeleteProducerDetails(customerId);
        return Ok();
    }
}

public class UpsertProducerDetailsRequest
{
    public string? SourceCustomerId { get; set; }

    [System.ComponentModel.DataAnnotations.Required]
    public string CustomerName { get; set; } = string.Empty;

    public decimal? TotalAcres { get; set; }
    public decimal? BinCapacity { get; set; }
    public string? PrimaryContact { get; set; }
    public string? Commodities { get; set; }
    public string? LinkedProducerIds { get; set; }
}
