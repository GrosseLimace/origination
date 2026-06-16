// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class FarmsController : ControllerBase
{
    private readonly IFarmService _service;

    public FarmsController(IFarmService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<FarmResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<FarmResponse>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single farm by ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(FarmResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FarmResponse>> GetById(string id, CancellationToken cancellationToken = default)
    {
        var farm = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Farm", id);
        return Ok(farm);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms for a specific customer. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<FarmResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<FarmResponse>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new farm.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(string), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<string>> Create([FromBody] CreateFarmRequest request, CancellationToken cancellationToken = default)
    {
        var id = await _service.CreateAsync(request.Name, request.Location, request.Acres, cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id }, id);
    }
}
