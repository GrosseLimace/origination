// Project namespaces
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<NotesController> _logger;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ApplicationDbContext _appContext;

    public NotesController(IDataService dataService, ILogger<NotesController> logger, IUserEntitlementService entitlementService, ApplicationDbContext appContext)
    {
        _dataService = dataService;
        _logger = logger;
        _entitlementService = entitlementService;
        _appContext = appContext;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<Note>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Note>>> GetAll([FromQuery] string? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var notes = await _dataService.GetNotesAsync(tuList, cancellationToken);
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        notes = notes.Where(n => n.TradeUnit == null || allowed.Contains(n.TradeUnit)).ToList();
        return Ok(notes);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes for a specific customer. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<Note>> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may add a note for any customer.

        // Derive TradeUnit from the authoritative dbo.CustomerTradeUnit rather than trusting the client-supplied value.
        // This prevents a caller from assigning a foreign trade unit to manipulate note visibility.
        // If a customer has multiple TUs, FirstOrDefaultAsync picks one non-deterministically.
        var tradeUnit = await _appContext.CustomerTradeUnits
            .Where(ctu => ctu.CustomerId == request.CustomerId && ctu.IsActive)
            .Select(ctu => ctu.TradeUnit)
            .FirstOrDefaultAsync(cancellationToken);

        try
        {
            var note = await _dataService.AddNoteAsync(request.CustomerId, request.Content, tradeUnit, cancellationToken);
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Note>> TogglePin(long id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may pin any note.
        _ = await _dataService.GetNoteByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<Note>> Update(long id, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may edit any note.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        _ = await _dataService.GetNoteByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
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
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(long id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any note.
        _ = await _dataService.GetNoteByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        await _dataService.DeleteNoteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Note deleted [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
