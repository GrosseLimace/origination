namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly IDataService _dataService;

    public NotesController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Note>), StatusCodes.Status200OK)]
    public ActionResult<List<Note>> GetAll()
    {
        return Ok(_dataService.GetNotes());
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Note>), StatusCodes.Status200OK)]
    public ActionResult<List<Note>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetNotesByCustomer(customerId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new note for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(Note), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public ActionResult<Note> Create([FromBody] CreateNoteRequest request)
    {
        try
        {
            var note = _dataService.AddNote(request.CustomerId, request.Content, request.TradeUnit);
            return Created($"/api/notes/{note.Id}", note);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("database permissions"))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "Service temporarily unavailable" });
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Toggles the pinned status of a note.</summary>
    [HttpPut("{id:long}/toggle-pin")]
    [ProducesResponseType(typeof(Note), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<Note> TogglePin(long id)
    {
        var note = _dataService.ToggleNotePin(id);
        if (note == null)
        {
            return NotFound();
        }
        return Ok(note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates the content of a note.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(Note), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<Note> Update(long id, [FromBody] UpdateNoteRequest request)
    {
        var note = _dataService.UpdateNote(id, request.Content);
        if (note == null)
        {
            return NotFound();
        }
        return Ok(note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a note by ID.</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult Delete(long id)
    {
        _dataService.DeleteNote(id);
        return NoContent();
    }
}
