// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

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
    public async Task<ActionResult<List<PlantingIntention>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetPlantingIntentionsAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all planting intentions for a specific customer.</summary>
    [HttpGet("customer/{customerId}")]
    [ProducesResponseType(typeof(List<PlantingIntention>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntention>>> GetByCustomer(int customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetPlantingIntentionsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new planting intention for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PlantingIntention>> Create([FromBody] CreatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        var intention = await _dataService.AddPlantingIntentionAsync(
            request.CustomerId,
            request.CustomerName,
            request.CustomerCode,
            request.TradeUnit,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear,
            cancellationToken
        );
        return Ok(intention);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing planting intention.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(PlantingIntention), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntention>> Update(int id, [FromBody] UpdatePlantingIntentionRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _dataService.UpdatePlantingIntentionAsync(
            id,
            request.Crop,
            request.Type,
            request.Description,
            request.Acres,
            request.PlantingYear,
            cancellationToken
        );
        if (updated == null)
        {
            throw new NotFoundException("PlantingIntention", id);
        }
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a planting intention by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeletePlantingIntentionAsync(id, cancellationToken);
        return NoContent();
    }
}
