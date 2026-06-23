// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly INoteService _service;
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly ILogger<NotesController> _logger;

    public NotesController(INoteService service, EntitlementsDbContext entitlementsDb, ILogger<NotesController> logger)
    {
        _service = service;
        _entitlementsDb = entitlementsDb;
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
    /// <summary>
    /// Lookup data for the "@" mention picker — people, trade units, and groups the caller
    /// can mention, scoped to the caller's trade-unit access (vw_UserTradeUnitAccess). Returns
    /// empty lists if the Entitlements DB is unavailable so the picker degrades gracefully.
    /// </summary>
    [HttpGet("mention-catalog")]
    [ProducesResponseType(typeof(MentionCatalogResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<MentionCatalogResponse>> GetMentionCatalog(CancellationToken cancellationToken = default)
    {
        // Derive the caller's UserId from the UPN claim (e.g. CEgr@scoular.com → CEgr),
        // matching how vw_UserTradeUnitAccess.UserId is stored.
        var upn = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("upn")?.Value
            ?? User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? User.Identity?.Name
            ?? string.Empty;
        var userId = upn.Contains('@') ? upn.Split('@')[0] : upn;

        var response = new MentionCatalogResponse();
        if (string.IsNullOrWhiteSpace(userId))
            return Ok(response);

        try
        {
            // The caller's own trade-unit assignments (gives their TU codes + group memberships).
            var callerRows = await _entitlementsDb.UserTradeUnitAccess
                .Where(u => u.UserId == userId)
                .Select(u => new { u.TradeUnitCode, u.Description, u.GroupId, u.GroupName })
                .ToListAsync(cancellationToken);

            var callerTuCodes = callerRows.Select(r => r.TradeUnitCode).Distinct().ToList();
            if (callerTuCodes.Count == 0)
                return Ok(response);

            // People who share at least one of the caller's trade units (excluding the caller).
            var peopleRows = await _entitlementsDb.UserTradeUnitAccess
                .Where(u => callerTuCodes.Contains(u.TradeUnitCode) && u.UserId != userId)
                .Select(u => new { u.UserId, u.DisplayName })
                .Distinct()
                .ToListAsync(cancellationToken);

            response.People = peopleRows
                .GroupBy(p => p.UserId)
                .Select(g => new MentionCatalogPerson
                {
                    UserId = g.Key,
                    DisplayName = g.Select(x => x.DisplayName).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d)) ?? g.Key,
                    Email = g.Key.Contains('@') ? g.Key : $"{g.Key}@scoular.com"
                })
                .OrderBy(p => p.DisplayName)
                .ToList();

            response.TradeUnits = callerRows
                .GroupBy(r => r.TradeUnitCode)
                .Select(g => new MentionCatalogTradeUnit
                {
                    Code = g.Key,
                    Description = g.Select(x => x.Description).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d))
                })
                .OrderBy(t => t.Code)
                .ToList();

            response.Groups = callerRows
                .Where(r => r.GroupId != null && !string.IsNullOrWhiteSpace(r.GroupName))
                .GroupBy(r => r.GroupId!.Value)
                .Select(g => new MentionCatalogGroup { GroupId = g.Key, Name = g.Select(x => x.GroupName!).First() })
                .OrderBy(g => g.Name)
                .ToList();

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Mention catalog: Entitlements DB unavailable for user {UserId} — returning empty catalog", userId);
            return Ok(response);
        }
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
        // customer. The service derives the authoritative trade unit, persists any "@" mentions,
        // and translates a DB-permissions failure to a 503.
        var note = await _service.CreateAsync(request.CustomerId, request.Content, request.Mentions, cancellationToken);
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
        var note = await _service.UpdateAsync(id, request.Content, request.Mentions, cancellationToken)
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
