// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class FarmsController : ControllerBase
{
    private readonly IDataService _dataService;

    public FarmsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Farm>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Farm>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetFarmsAsync(cancellationToken));
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
    /// <summary>Gets all farms for a specific customer.</summary>
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
