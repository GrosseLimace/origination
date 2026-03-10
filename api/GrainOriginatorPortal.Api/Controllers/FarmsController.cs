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
    public ActionResult<List<Farm>> GetAll()
    {
        return Ok(_dataService.GetFarms());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets a single farm by ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(Farm), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<Farm> GetById(string id)
    {
        var farm = _dataService.GetFarmById(id);
        if (farm == null)
        {
            return NotFound();
        }
        return Ok(farm);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all farms for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Farm>), StatusCodes.Status200OK)]
    public ActionResult<List<Farm>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetFarmsByCustomer(customerId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new farm.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(string), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public ActionResult<string> Create([FromBody] CreateFarmRequest request)
    {
        var id = _dataService.CreateFarm(request.Name, request.Location, request.Acres);
        return CreatedAtAction(nameof(GetById), new { id }, id);
    }
}
