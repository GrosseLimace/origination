// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class FarmsController : ControllerBase
{
    private readonly IDataService _dataService;

    public FarmsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Farm>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Farm>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetFarmsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single farm by ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(Farm), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Farm>> GetById(string id, CancellationToken cancellationToken = default)
    {
        var farm = await _dataService.GetFarmByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Farm", id);
        return Ok(farm);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms for a specific customer. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Farm>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Farm>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetFarmsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new farm.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(string), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<string>> Create([FromBody] CreateFarmRequest request, CancellationToken cancellationToken = default)
    {
        var id = await _dataService.CreateFarmAsync(request.Name, request.Location, request.Acres, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id }, id);
    }
}
