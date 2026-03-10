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
    public ActionResult<List<Commodity>> GetAll()
    {
        return Ok(_dataService.GetCommodities());
    }
}
