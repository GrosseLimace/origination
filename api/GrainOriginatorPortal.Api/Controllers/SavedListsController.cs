// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class SavedListsController : ControllerBase
{
    private readonly IDataService _dataService;

    public SavedListsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all saved customer lists.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<SavedList>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<SavedList>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetSavedListsAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new saved customer list.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<SavedList>> Create([FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        var savedList = await _dataService.SaveListAsync(request.Name, request.Query, request.TradeUnits, request.Filters, cancellationToken);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing saved list by ID.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SavedList>> Update(int id, [FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _dataService.UpdateListAsync(id, request.Name, request.Query, request.TradeUnits, request.Filters, cancellationToken)
            ?? throw new NotFoundException("SavedList", id);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a saved list by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteListAsync(id, cancellationToken);
        return NoContent();
    }
}
