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
    public ActionResult<List<SavedList>> GetAll()
    {
        return Ok(_dataService.GetSavedLists());
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new saved customer list.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public ActionResult<SavedList> Create([FromBody] CreateSavedListRequest request)
    {
        var savedList = _dataService.SaveList(request.Name, request.Query, request.TradeUnits, request.Filters);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing saved list by ID.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<SavedList> Update(int id, [FromBody] CreateSavedListRequest request)
    {
        var updated = _dataService.UpdateList(id, request.Name, request.Query, request.TradeUnits, request.Filters);
        if (updated == null)
        {
            return NotFound();
        }
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a saved list by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Delete(int id)
    {
        _dataService.DeleteList(id);
        return NoContent();
    }
}
