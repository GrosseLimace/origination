// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class NotesController : ControllerBase
{
    private readonly INoteService _service;
    private readonly IEntitlementsDirectoryService _directory;
    private readonly IDailyRecapGroupService _recapGroups;
    private readonly ITeamsChannelService _teamsChannels;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<NotesController> _logger;

    public NotesController(
        INoteService service,
        IEntitlementsDirectoryService directory,
        IDailyRecapGroupService recapGroups,
        ITeamsChannelService teamsChannels,
        IRequestContextService requestContext,
        ILogger<NotesController> logger)
    {
        _service = service;
        _directory = directory;
        _recapGroups = recapGroups;
        _teamsChannels = teamsChannels;
        _requestContext = requestContext;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all notes. Optional server-side filters keep note-scoped prompts from pulling
    /// the entire set: <c>sinceDays</c> (recency window), <c>contentAny</c> (comma-separated
    /// keywords — returns notes whose text contains ANY), <c>authorAny</c> (comma-separated author
    /// candidates — matches CreatedBy/ModifiedBy), and <c>pinnedOnly</c>. Each returns a SUPERSET
    /// the client then matches exactly, so results are unchanged.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<NoteResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<NoteResponse>>> GetAll(
        [FromQuery] string? tradeUnits = null,
        [FromQuery] int? sinceDays = null,
        [FromQuery] string? contentAny = null,
        [FromQuery] string? authorAny = null,
        [FromQuery] bool pinnedOnly = false,
        [FromQuery] string? customerIds = null,
        CancellationToken cancellationToken = default)
    {
        // Not entitlement-scoped, by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02), which
        // lists this route. The `tradeUnits` arg narrows by the CUSTOMER's trade unit when a caller
        // passes it — it is a relevance filter, not a boundary, and no caller passes it today.
        // Re-flagged as M-042 (2026-09-21); scoping it would restrict nobody, because originators
        // self-assign their trade units in the Trade Unit Preferences app. See AR-02's banner.
        return Ok(await _service.GetAllAsync(tradeUnits, sinceDays, contentAny, authorAny, pinnedOnly, customerIds, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Per-customer "last contacted" aggregate — one row per customer with notes
    /// ({customerId, customerCode, lastNoteAt}). Covers ALL notes per producer (no trade-unit
    /// filter — notes are open per producer, matching the per-customer endpoint), so linked
    /// producers in unselected TUs are represented and the badge reflects the true latest
    /// contact. Ships no note bodies; payload is bounded by customer count, not note count.</summary>
    [HttpGet("last-contact")]
    [ProducesResponseType(typeof(List<NoteLastContactResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<NoteLastContactResponse>>> GetLastContact(CancellationToken cancellationToken = default)
    {
        // Not entitlement-scoped, by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02), which
        // lists this route. Ships dates and customer codes only — no note bodies — and the customer
        // LIST is separately scoped, so surplus rows never reach the UI. Re-flagged as M-042.
        return Ok(await _service.GetLastContactAsync(cancellationToken));
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
    /// Lookup data for the "@" mention picker — people, trade units and trade-unit groups from the
    /// caller's entitlements (vw_UserTradeUnitPreferences), plus the caller's own groups from the
    /// Origination DB. The two sources are gathered independently and each degrades to an empty
    /// list on failure, so the picker never 500s and one database being down can't hide the other's
    /// results.
    /// </summary>
    [HttpGet("mention-catalog")]
    [ProducesResponseType(typeof(MentionCatalogResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<MentionCatalogResponse>> GetMentionCatalog(CancellationToken cancellationToken = default)
    {
        // The caller's UserId is the UPN prefix (e.g. CEgr@scoular.com → CEgr), matching how
        // vw_UserTradeUnitPreferences.UserId is stored — which is what
        // IRequestContextService.GetCurrentUserShortName already resolves. The claim chain used to
        // be reimplemented here and in EntitlementsController.GetCatalog.
        var userId = _requestContext.GetCurrentUserShortName();

        var response = new MentionCatalogResponse();

        // ── Source 1: TradeUnitPreferences DB — people / trade units / trade-unit groups ──────────────
        if (!string.IsNullOrWhiteSpace(userId))
        {
            try
            {
                // The caller's own trade-unit assignments (gives their TU codes + group memberships).
                var callerRows = await _directory.GetAssignmentsAsync(userId, cancellationToken);

                var callerTuCodes = callerRows.Select(r => r.TradeUnitCode).Distinct().ToList();
                // No trade units → nothing to offer from this source. Falls through rather than
                // returning: the caller can still own groups, which Source 2 supplies.
                if (callerTuCodes.Count > 0)
                {
                    // People who share at least one of the caller's trade units. The caller is
                    // INCLUDED so they can @-mention themselves (they're in their own trade units).
                    //
                    // Restricted to ACTIVE users in dbo.Users, which is a different table from the
                    // view driving this query — a leaver can linger in the trade-unit assignments
                    // after being deactivated. Two reasons this filter matters: NoteService rejects a
                    // mention of an inactive user on save (H-056), so offering one here would put a
                    // name in the picker that the save then refuses; and even before that check
                    // existed, the Logic App skipped inactive recipients at send time, so mentioning
                    // one produced a note the author believed was shared with nobody notified.
                    var peopleRows = await _directory.GetColleaguesAsync(callerTuCodes, activeOnly: true, cancellationToken);

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

                    response.TradeUnitGroups = callerRows
                        .Where(r => r.GroupId != null && !string.IsNullOrWhiteSpace(r.GroupName))
                        .GroupBy(r => r.GroupId!.Value)
                        .Select(g => new MentionCatalogGroup { GroupId = g.Key, Name = g.Select(x => x.GroupName!).First() })
                        .OrderBy(g => g.Name)
                        .ToList();
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Mention catalog: TradeUnitPreferences DB unavailable for user {UserId} — omitting people and trade units", userId);
                response.Degraded = true;
            }
        }

        // ── Source 2: Origination DB — the caller's own groups ────────────────────────────────
        // Separate try/catch on purpose: a different database, an independent failure domain.
        // Same visibility query NoteService expands with, so the picker can never offer a group the
        // save would reject. NOT filtered on Enabled — that flag means "send the daily recap",
        // which is orthogonal to being mentionable. Empty groups are omitted: mentioning one would
        // notify nobody — UNLESS it delivers to a Teams channel, which is a recipient in its own
        // right, so a Teams entry with no members is still worth offering.
        try
        {
            response.AppGroups = (await _recapGroups.GetAllAsync(cancellationToken))
                .Select(g => new
                {
                    Group = g,
                    PostsToChannel = string.Equals(g.DeliveryMethod, "teams", StringComparison.OrdinalIgnoreCase),
                })
                .Where(x => x.Group.Members.Count > 0 || x.PostsToChannel)
                .Select(x => new MentionCatalogAppGroup
                {
                    GroupId = x.Group.Id,
                    Name = x.Group.Name,
                    MemberCount = x.Group.Members.Count,
                    IsOwner = x.Group.IsOwner,
                    PostsToChannel = x.PostsToChannel,
                })
                .OrderBy(g => g.Name)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Mention catalog: groups unavailable for user {UserId} — omitting them", userId);
            response.Degraded = true;
        }

        // ── Source 3: registered Teams channels ───────────────────────────────────────────────
        // Same independent-failure-domain treatment: losing the registry must not empty the rest of
        // the picker. Deliberately unscoped — see MentionCatalogResponse.TeamsChannels.
        try
        {
            response.TeamsChannels = (await _teamsChannels.GetAllAsync(cancellationToken))
                .Select(c => new MentionCatalogTeamsChannel
                {
                    ChannelDbId = c.Id,
                    DisplayName = c.DisplayName,
                    TeamName = c.TeamName,
                    ChannelId = c.ChannelId,
                })
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Mention catalog: Teams channels unavailable — omitting them");
            response.Degraded = true;
        }

        return Ok(response);
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
            "Note created [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, CustomerId={CustomerId}, User={User}",
            "AUDIT_CREATE", "DataMutation", note.Id, request.CustomerId, _requestContext.GetCurrentUser());
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
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        var note = await _service.TogglePinAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        // The actor is recorded HERE and nowhere else: toggling a pin deliberately does not stamp
        // ModifiedBy/ModifiedAt on the row. Those two fields mean "someone edited the text" —
        // ModifiedBy feeds NLQ author search ("notes by <name>") and ModifiedAt drives note sort
        // order, so stamping them on a pin would forge authorship and reorder the list. M-041
        // (2026-09-21) credited this path with attribution it did not have; this log line is it.
        _logger.LogInformation(
            "Note pin toggled [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, IsPinned={IsPinned}, User={User}",
            "AUDIT_UPDATE", "DataMutation", note.Id, note.IsPinned, _requestContext.GetCurrentUser());
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
            "Note updated [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, User={User}",
            "AUDIT_UPDATE", "DataMutation", note.Id, _requestContext.GetCurrentUser());
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
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        _ = await _service.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("Note", id);
        await _service.DeleteAsync(id, cancellationToken);
        // Soft delete: the row survives with IsDeleted/DeletedAt/DeletedBy and is recoverable.
        // M-041 (2026-09-21) described this as destroying a colleague's note — it does not.
        _logger.LogInformation(
            "Note deleted [{ErrorCode}] [{ErrorCategory}]: NoteId={NoteId}, User={User}",
            "AUDIT_DELETE", "DataMutation", id, _requestContext.GetCurrentUser());
        return NoContent();
    }
}
