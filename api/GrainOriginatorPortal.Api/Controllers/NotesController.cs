// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly INoteService _service;
    private readonly ILogger<NotesController> _logger;

    public NotesController(INoteService service, ILogger<NotesController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<NoteResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<NoteResponse>>> GetAll([FromQuery] string? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes for a specific customer. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<NoteResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<NoteResponse>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new note for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(NoteResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<NoteResponse>> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may add a note for any
        // customer. The service derives the authoritative trade unit and translates a DB-permissions
        // failure to a 503.
        var note = await _service.CreateAsync(request.CustomerId, request.Content, cancellationToken);
        _logger.LogInformation(
            "Note created [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, CustomerId={CustomerId}",
            "AUDIT_CREATE", "DataMutation", note.Id, request.CustomerId);
        return Created($"/api/notes/{note.Id}", note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Toggles the pinned status of a note.</summary>
    [HttpPut("{id:long}/toggle-pin")]
    [ProducesResponseType(typeof(NoteResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> TogglePin(long id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may pin any note.
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        var note = await _service.TogglePinAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        _logger.LogInformation(
            "Note pin toggled [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, IsPinned={IsPinned}",
            "AUDIT_UPDATE", "DataMutation", note.Id, note.IsPinned);
        return Ok(note);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates the content of a note.</summary>
    [HttpPut("{id:long}")]
    [ProducesResponseType(typeof(NoteResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> Update(long id, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may edit any note.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        var note = await _service.UpdateAsync(id, request.Content, cancellationToken)
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(long id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any note.
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        await _service.DeleteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Note deleted [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
