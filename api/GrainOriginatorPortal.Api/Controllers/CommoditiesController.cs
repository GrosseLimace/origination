namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
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

    /// <summary>Gets commodity conversion factors (lbs per bushel) from ODS.</summary>
    [HttpGet("conversions")]
    [ProducesResponseType(typeof(List<CommodityConversion>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CommodityConversion>>> GetConversions(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetCommodityConversionsAsync(cancellationToken));
    }

    /// <summary>Gets harvest delivery windows per commodity.</summary>
    [HttpGet("harvest-windows")]
    [ProducesResponseType(typeof(List<HarvestWindow>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<HarvestWindow>>> GetHarvestWindows(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetHarvestWindowsAsync(cancellationToken));
    }
}
