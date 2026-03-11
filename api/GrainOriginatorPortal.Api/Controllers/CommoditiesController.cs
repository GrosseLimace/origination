namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CommoditiesController : ControllerBase
{
    private readonly IDataService _dataService;

    public CommoditiesController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all active commodities.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Commodity>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Commodity>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetCommoditiesAsync(cancellationToken));
    }
}
