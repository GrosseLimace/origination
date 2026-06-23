using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class CommoditiesController : ControllerBase
{
    private readonly ICommodityService _service;

    public CommoditiesController(ICommodityService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all active commodities.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<CommodityResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CommodityResponse>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the curated commodities flagged for the Planting Intentions crop dropdown.</summary>
    [HttpGet("planting")]
    [ProducesResponseType(typeof(List<CommodityResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CommodityResponse>>> GetPlanting(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetPlantingAsync(cancellationToken));
    }

    /// <summary>Gets commodity conversion factors (lbs per bushel) from ODS.</summary>
    [HttpGet("conversions")]
    [ProducesResponseType(typeof(List<CommodityConversionResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CommodityConversionResponse>>> GetConversions(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetConversionsAsync(cancellationToken));
    }

    /// <summary>Gets harvest delivery windows per commodity.</summary>
    [HttpGet("harvest-windows")]
    [ProducesResponseType(typeof(List<HarvestWindowResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<HarvestWindowResponse>>> GetHarvestWindows(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetHarvestWindowsAsync(cancellationToken));
    }
}
