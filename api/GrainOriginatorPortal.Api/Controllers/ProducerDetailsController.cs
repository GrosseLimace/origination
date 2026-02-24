using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IDataService _dataService;

    public ProducerDetailsController(IDataService dataService)
    {
        _dataService = dataService;
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
        if (details == null) return NotFound();
        return Ok(details);
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
        catch (Exception)
        {
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
