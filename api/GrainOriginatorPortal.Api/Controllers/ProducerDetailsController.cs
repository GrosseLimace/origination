namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<ProducerDetailsController> _logger;

    public ProducerDetailsController(IDataService dataService, ILogger<ProducerDetailsController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all producer details records.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProducerDetails>), StatusCodes.Status200OK)]
    public ActionResult<List<ProducerDetails>> GetAll()
    {
        return Ok(_dataService.GetAllProducerDetails());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets producer details for a specific customer. Returns an empty record if not yet saved.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    public ActionResult<ProducerDetails> GetByCustomer(long customerId)
    {
        var details = _dataService.GetProducerDetails(customerId);
        return Ok(details ?? new ProducerDetails { CustomerId = customerId });
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates producer details for a customer.</summary>
    [HttpPut("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = "Failed to save producer details" });
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes producer details for a customer.</summary>
    [HttpDelete("customer/{customerId:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Delete(long customerId)
    {
        _dataService.DeleteProducerDetails(customerId);
        return NoContent();
    }
}
