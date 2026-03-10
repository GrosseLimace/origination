namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IDataService _dataService;

    public ProducerDetailsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all producer details records.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProducerDetails>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ProducerDetails>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetAllProducerDetailsAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets producer details for a specific customer. Returns an empty record if not yet saved.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProducerDetails>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        var details = await _dataService.GetProducerDetailsAsync(customerId, cancellationToken);
        return Ok(details ?? new ProducerDetails { CustomerId = customerId });
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates producer details for a customer.</summary>
    [HttpPut("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProducerDetails>> Upsert(long customerId, [FromBody] UpsertProducerDetailsRequest request, CancellationToken cancellationToken = default)
    {
        var details = await _dataService.UpsertProducerDetailsAsync(
            customerId,
            request.SourceCustomerId,
            request.CustomerName,
            request.TotalAcres,
            request.BinCapacity,
            request.PrimaryContact,
            request.Commodities,
            request.LinkedProducerIds,
            cancellationToken
        );
        return Ok(details);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes producer details for a customer.</summary>
    [HttpDelete("customer/{customerId:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(long customerId, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteProducerDetailsAsync(customerId, cancellationToken);
        return NoContent();
    }
}
