namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class TradeUnitGroupsController : ControllerBase
{
    private readonly IDataService _dataService;

    public TradeUnitGroupsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all trade unit groups with their member trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<TradeUnitGroup>), StatusCodes.Status200OK)]
    public ActionResult<List<TradeUnitGroup>> GetAll()
    {
        return Ok(_dataService.GetTradeUnitGroups());
    }
}
