namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class PlantingIntentionsController : ControllerBase
{
    private readonly IDataService _dataService;

    public PlantingIntentionsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public ActionResult<List<PlantingIntention>> GetAll()
    {
        return Ok(_dataService.GetPlantingIntentions());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer.</summary>
    [HttpGet("customer/{customerId}")]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public ActionResult<List<PlantingIntention>> GetByCustomer(int customerId)
    {
        return Ok(_dataService.GetPlantingIntentionsByCustomer(customerId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new planting intention for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public ActionResult<PlantingIntention> Create([FromBody] CreatePlantingIntentionRequest request)
    {
        var intention = _dataService.AddPlantingIntention(
            request.CustomerId,
            request.CustomerName,
            request.CustomerCode,
            request.TradeUnit,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear
        );
        return Ok(intention);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing planting intention.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<PlantingIntention> Update(int id, [FromBody] UpdatePlantingIntentionRequest request)
    {
        var updated = _dataService.UpdatePlantingIntention(
            id,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear
        );
        if (updated == null)
        {
            return NotFound();
        }
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a planting intention by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Delete(int id)
    {
        _dataService.DeletePlantingIntention(id);
        return NoContent();
    }
}
