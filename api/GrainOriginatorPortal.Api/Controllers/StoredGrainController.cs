namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class StoredGrainController : ControllerBase
{
    private readonly IDataService _dataService;

    public StoredGrainController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all stored grain records.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<StoredGrain>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrain>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetStoredGrainAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets stored grain records for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<StoredGrain>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrain>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetStoredGrainByCustomerAsync(customerId, cancellationToken));
    }
}
