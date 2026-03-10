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
    public ActionResult<List<StoredGrain>> GetAll()
    {
        return Ok(_dataService.GetStoredGrain());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets stored grain records for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<StoredGrain>), StatusCodes.Status200OK)]
    public ActionResult<List<StoredGrain>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetStoredGrainByCustomer(customerId));
    }
}
