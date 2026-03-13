// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<NotesController> _logger;

    public NotesController(IDataService dataService, ILogger<NotesController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Note>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Note>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetNotesAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Note>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Note>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetNotesByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new note for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(Note), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<Note>> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        // Access already validated when the user loaded the customer (GET endpoints check entitlements).
        // Redundant validation here caused 403s when vw_CustomerTradeUnits had incomplete mappings.
        try
        {
            var note = await _dataService.AddNoteAsync(request.CustomerId, request.Content, request.TradeUnit, cancellationToken);
            _logger.LogInformation(
                "Note created [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, CustomerId={CustomerId}",
                "AUDIT_CREATE", "DataMutation", note.Id, request.CustomerId);
            return Created($"/api/notes/{note.Id}", note);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("database permissions"))
        {
            throw new InfrastructureException(
                "Notes service is temporarily unavailable due to a permissions issue.",
                "INFRASTRUCTURE_DATABASE_UNAVAILABLE",
                ex,
                StatusCodes.Status503ServiceUnavailable);
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Toggles the pinned status of a note.</summary>
    [HttpPut("{id:long}/toggle-pin")]
    [ProducesResponseType(typeof(Note), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Note>> TogglePin(long id, CancellationToken cancellationToken = default)
    {
        var note = await _dataService.ToggleNotePinAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        _logger.LogInformation(
            "Note pin toggled [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, IsPinned={IsPinned}",
            "AUDIT_UPDATE", "DataMutation", note.Id, note.IsPinned);
        return Ok(note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates the content of a note.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(Note), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Note>> Update(long id, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        var note = await _dataService.UpdateNoteAsync(id, request.Content, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        _logger.LogInformation(
            "Note updated [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}",
            "AUDIT_UPDATE", "DataMutation", note.Id);
        return Ok(note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a note by ID.</summary>
    [HttpDelete("{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(long id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteNoteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Note deleted [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
