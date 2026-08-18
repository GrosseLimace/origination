using System.Text.Json;
using System.Text.RegularExpressions;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public partial class NoteService : INoteService
{
    private readonly INoteRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;
    private readonly IDailyRecapGroupService _groups;
    private readonly ILogger<NoteService> _logger;

    public NoteService(
        INoteRepository repository,
        ICustomerRepository customerRepository,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext,
        IDailyRecapGroupService groups,
        ILogger<NoteService> logger)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
        _groups = groups;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<NoteResponse>> GetAllAsync(string? tradeUnits, int? sinceDays, string? contentAny, string? authorAny, bool pinnedOnly, string? customerIds, CancellationToken cancellationToken)
    {
        // No trade-unit entitlement filter on the notes themselves: trade units scope WHICH
        // producers a rep works (the customers query / optional producer-TU filter below), not
        // which of a producer's notes are visible. This matches the aggregate and per-customer
        // note endpoints so badges, the profile, and NLQ/search all see the same note set.
        // Per AR-02, trade-unit entitlement on list/search views is a relevance default, not an
        // access boundary. The optional tradeUnits arg still scopes by the customer's TU when a
        // caller passes it (producer scoping — no caller does today).
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // sinceDays > 0 windows the read to recently-created notes (date-scoped prompts). A
        // null/<=0 value keeps the full-set behavior. Cutoff is UTC midnight N days back so
        // "last 1 day" reliably covers all of yesterday regardless of the current time of day.
        DateTime? createdSinceUtc = sinceDays is > 0
            ? DateTime.UtcNow.Date.AddDays(-sinceDays.Value)
            : null;
        // contentAny / authorAny are comma-separated match terms the CLIENT extracted (keywords /
        // author candidates). The repo returns any note matching ANY of them — a superset the
        // client then narrows with its exact matching, so no note the client needs is dropped.
        var contentTerms = contentAny?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var authorTerms = authorAny?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        // customerIds scopes the read to specific producers (per-batch note loading for huge
        // note lists). Non-numeric tokens are ignored rather than failing the whole request.
        var customerIdList = customerIds?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => long.TryParse(s, out var id) ? id : (long?)null)
            .Where(id => id.HasValue).Select(id => id!.Value).ToList();
        var notes = await _repository.GetAsync(tuList, createdSinceUtc, contentTerms, authorTerms, pinnedOnly, customerIdList, cancellationToken);
        return await MapWithNamesAsync(notes, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<List<NoteLastContactResponse>> GetLastContactAsync(CancellationToken cancellationToken)
    {
        // No entitlement gate: notes are open per producer (AR-02), so the badge aggregate
        // matches the per-customer note endpoints (GetByCustomerAsync/GetByIdAsync), which are
        // also ungated. It ships only dates + customer codes (no note content). The customer
        // LIST is separately trade-unit-scoped, so extra aggregate rows are never surfaced.
        var rows = await _repository.GetLastContactAsync(cancellationToken);
        return rows.Select(r => r.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<NoteResponse>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var notes = await _repository.GetByCustomerAsync(customerId, cancellationToken);
        return await MapWithNamesAsync(notes, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<NoteResponse?> GetByIdAsync(long noteId, CancellationToken cancellationToken)
    {
        var note = await _repository.GetByIdAsync(noteId, cancellationToken);
        return note is null ? null : note.ToResponse(await ResolveAsync(note, cancellationToken));
    }

    /// <inheritdoc />
    public async Task<NoteResponse> CreateAsync(long customerId, string content, IReadOnlyList<NoteMention>? mentions, CancellationToken cancellationToken)
    {
        // Derive TradeUnit from the authoritative dbo.CustomerTradeUnit rather than trusting the
        // client. Prevents a caller from assigning a foreign trade unit to manipulate note visibility.
        // (Logic moved out of NotesController.Create so the controller no longer touches a DbContext.)
        var tradeUnit = await _customerRepository.GetFirstActiveTradeUnitAsync(customerId, cancellationToken);

        // Built OUTSIDE the try below: that catch filter maps a repository permissions failure to a
        // 503, and expansion raises its own 400/503 that must not be reinterpreted by it.
        var mentionsJson = await BuildMentionsJsonAsync(mentions, cancellationToken);

        Note note;
        try
        {
            note = await _repository.AddAsync(customerId, content, tradeUnit, mentionsJson, _requestContext.GetCurrentUser(), cancellationToken);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("database permissions"))
        {
            throw new InfrastructureException(
                "Notes service is temporarily unavailable due to a permissions issue.",
                "INFRASTRUCTURE_DATABASE_UNAVAILABLE",
                ex,
                StatusCodes.Status503ServiceUnavailable);
        }

        var nameMap = await _displayNameLookup.ResolveAsync(new[] { note.CreatedBy }, cancellationToken);
        return note.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<NoteResponse?> TogglePinAsync(long noteId, CancellationToken cancellationToken)
    {
        var note = await _repository.TogglePinAsync(noteId, cancellationToken);
        return note is null ? null : note.ToResponse(await ResolveAsync(note, cancellationToken));
    }

    /// <inheritdoc />
    public async Task<NoteResponse?> UpdateAsync(long noteId, string content, IReadOnlyList<NoteMention>? mentions, CancellationToken cancellationToken)
    {
        // null = the caller sent no mentions field at all → leave the note's mentions ALONE.
        // [] = the caller explicitly cleared them. The two used to be conflated, so editing a
        // note's text through a client that omits mentions destroyed them (and their highlighting).
        var replaceMentions = mentions is not null;
        var mentionsJson = await BuildMentionsJsonAsync(mentions, cancellationToken);
        var note = await _repository.UpdateAsync(noteId, content, mentionsJson, replaceMentions, _requestContext.GetCurrentUser(), cancellationToken);
        return note is null ? null : note.ToResponse(await ResolveAsync(note, cancellationToken));
    }

    /// <summary>The only domain a note mention may resolve to. Person recipients are rebuilt as
    /// <c>localPart@{InternalEmailDomain}</c>, so no persisted mention can address an outside domain.</summary>
    private const string InternalEmailDomain = "scoular.com";

    /// <summary>The most mention rows a single note may carry AFTER group expansion. The inbound
    /// [MaxLength(50)] on the request caps only what the client sent — model validation runs before
    /// expansion, so one group can multiply well past it. The blow-up guard has to live here.</summary>
    private const int MaxExpandedMentions = 250;

    /// <summary>Expands the caller's own group mentions, then normalizes and serializes everything to
    /// the JSON stored on the note. Null/empty → null so the column stays NULL rather than "[]".
    /// <para>
    /// ORDER IS LOAD-BEARING. Expansion runs FIRST and emits raw member references; then EVERY row —
    /// client-sent and expanded alike — goes through <see cref="NormalizeMention"/>. That is what
    /// extends the M-025 guarantees to group members: a person member's address is rebuilt from its
    /// id, non-person rows lose their email, and a member id carrying a foreign domain is rejected.
    /// Swapping these two lines would make the group path a laundering route around a rule the
    /// direct path enforces.
    /// </para></summary>
    private async Task<string?> BuildMentionsJsonAsync(IReadOnlyList<NoteMention>? mentions, CancellationToken cancellationToken)
    {
        if (mentions is not { Count: > 0 }) return null;
        var expanded = await ExpandGroupsAsync(mentions, cancellationToken);
        var normalized = expanded.Select(NormalizeMention).ToList();
        return JsonSerializer.Serialize(normalized);
    }

    /// <summary>Replaces each "app-group" mention with the group's own row PLUS one row per member,
    /// typed with the person / trade-unit / trade-unit-group vocabulary the Instant Share Note Logic
    /// App already resolves. Two consequences worth stating: the Logic App needs no change, and
    /// trade-unit members stay a single row that it expands LIVE at send time — so entitlement
    /// resolution keeps living in exactly one place, and a 40-person trade unit doesn't become 40
    /// rows in the note. The group row itself is kept so "@Group Name" still highlights on the saved
    /// note and the note records which group was used.
    /// <para>
    /// Visibility is the SAME query that builds the picker (<see cref="IDailyRecapGroupService.GetAllAsync"/>
    /// — groups the caller created or belongs to), so the dropdown can never offer a group the save
    /// then rejects.
    /// </para></summary>
    private async Task<List<NoteMention>> ExpandGroupsAsync(IReadOnlyList<NoteMention> mentions, CancellationToken cancellationToken)
    {
        var hasGroup = mentions.Any(m => string.Equals(m.Type, NoteMention.AppGroupType, StringComparison.OrdinalIgnoreCase));
        if (!hasGroup)
        {
            // Hot path: an ordinary note pays nothing for this feature.
            return mentions.ToList();
        }

        List<RecapGroupDto> visible;
        try
        {
            visible = await _groups.GetAllAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Fail CLOSED: we can't prove who the group resolves to, and a note that silently
            // reaches nobody is worse than a retryable error the user can see. Note this is a
            // stricter policy than GetAllAsync's own — it degrades an Entitlements outage to
            // owned-only groups, deliberately, because a note save is high-frequency and blocking.
            _logger.LogWarning(ex, "Groups unavailable while expanding note mentions — rejecting the save");
            throw new InfrastructureException(
                "Can't look up that group right now. Please try again in a moment.",
                "INFRASTRUCTURE_DATABASE_UNAVAILABLE", ex, StatusCodes.Status503ServiceUnavailable);
        }

        var result = new List<NoteMention>(mentions.Count);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Dedupe on type+id so a person mentioned directly AND through a group is stored once. The
        // FIRST occurrence wins, and client-sent rows are walked before their expansions, so a
        // direct mention keeps its null Via rather than being recorded as group-derived.
        bool Add(NoteMention mention)
        {
            var id = mention.Id?.Trim() ?? string.Empty;
            if (id.Length == 0) return false;
            if (!seen.Add($"{mention.Type?.ToLowerInvariant()}|{id.ToLowerInvariant()}")) return false;
            result.Add(mention with { Id = id });
            return true;
        }

        foreach (var mention in mentions)
        {
            // Via is server-set provenance; clear whatever the client sent so it can't be forged.
            if (!Add(mention with { Via = null })) continue;
            if (!string.Equals(mention.Type, NoteMention.AppGroupType, StringComparison.OrdinalIgnoreCase)) continue;

            var group = visible.FirstOrDefault(g => g.Id.ToString() == mention.Id.Trim());
            if (group is null)
            {
                // Rejected, never silently dropped: the alternative is a note the author believes
                // was shared with a dozen people that notified none of them, with no signal anywhere.
                // ValidationException (400), not ForbiddenException — the client's 403 handler fires
                // its own toast and would double up on this one.
                throw new ValidationException("mentions",
                    $"The group '{mention.Name}' is no longer available to you. Remove the mention, or refresh the page and try again.");
            }

            // An empty group contributes no resolvable rows, and the app-group row itself resolves
            // to nobody — so this would save a note the author believes was shared and notify no
            // one. The picker omits empty groups; this catches one emptied since it was loaded.
            if (group.Members.Count == 0)
            {
                throw new ValidationException("mentions",
                    $"The group '{group.Name}' has no members, so nobody would be notified.");
            }

            // Authoritative name — never persist the client's label for a row we own.
            result[^1] = result[^1] with { Name = group.Name };

            foreach (var member in group.Members)
            {
                // Groups can't contain groups (RecapGroupRequest constrains member types, and the
                // recap service throws on anything else). Skipping them anyway keeps this a single
                // non-recursive pass, so future schema drift can't turn it into infinite expansion.
                if (string.Equals(member.Type, NoteMention.AppGroupType, StringComparison.OrdinalIgnoreCase)) continue;

                // Email dropped deliberately even though the stored member email is itself
                // server-derived: NormalizeMention is the single place that decides an address.
                Add(new NoteMention
                {
                    Type = member.Type,
                    Id = member.Id,
                    Name = string.IsNullOrWhiteSpace(member.Name) ? member.Id : member.Name,
                    Email = null,
                    Via = $"{NoteMention.AppGroupType}:{group.Id}",
                });
            }
        }

        if (result.Count > MaxExpandedMentions)
        {
            throw new ValidationException("mentions",
                $"That would mention {result.Count} recipients (limit {MaxExpandedMentions}). Try mentioning fewer groups.");
        }

        return result;
    }

    /// <summary>Rebuilds a person mention's email as an internal address derived from its id, and
    /// drops emails from non-person mentions. Throws when the id is not an internal identity —
    /// the mention catalog only ever emits internal short names/UPNs, so anything else is forged.</summary>
    private static NoteMention NormalizeMention(NoteMention mention)
    {
        if (!string.Equals(mention.Type, "person", StringComparison.OrdinalIgnoreCase))
        {
            // Non-person ids are INTERPOLATED INTO AN ODATA $filter by the Instant Share Note and
            // Daily Recap workflows ("TradeUnitCode eq @{item()?['id']}", "GroupId eq @{...}"),
            // unquoted and unescaped. Model validation only bounds the length, so without this an
            // authenticated caller could post a mention whose id widens the filter — e.g. an id that
            // appends "or IsActive eq 1" — and have the workflow mail the note body to everyone the
            // broadened query returns, from a privileged shared mailbox. The workflows can't defend
            // themselves (no parameterisation in the SQL connector's $filter), so the id is pinned
            // to a safe shape HERE, at the same place the person path is already pinned.
            // Store the SAME string that was validated. Trimming after the check would mean the
            // filter receives a value this method never inspected.
            return mention with { Id = ValidateNonPersonMentionId(mention), Email = null };
        }

        // Accept exactly two shapes: a bare short name ("CEgr") or a full internal UPN
        // ("CEgr@scoular.com"). A foreign domain, extra '@', or empty local part is rejected rather
        // than silently coerced, so a forged id can never become a mail recipient. The stored
        // address is CONSTRUCTED (never passed through), so the domain is guaranteed by build.
        var id = mention.Id.Trim();
        var segments = id.Split('@');
        var localPart = segments[0];
        var isBareName = segments.Length == 1;
        var isInternalUpn = segments.Length == 2
            && string.Equals(segments[1], InternalEmailDomain, StringComparison.OrdinalIgnoreCase);

        if (localPart.Length == 0 || (!isBareName && !isInternalUpn))
            throw new ValidationException("mentions",
                $"Person mention '{mention.Id}' is not an internal {InternalEmailDomain} identity.");

        return mention with { Email = $"{localPart}@{InternalEmailDomain}" };
    }

    /// <summary>Pins a non-person mention id to the shape its backing column actually holds, so it
    /// can't carry OData filter syntax into the workflows. Trade unit ids are matched against
    /// TradeUnitCode (nvarchar(20)); trade-unit-group and app-group ids are integer keys (GroupId,
    /// DailyRecapGroups.Id). Anything else is rejected loudly rather than trimmed — a mention the
    /// catalog didn't emit is forged, and quietly coercing it would hide that.</summary>
    /// <returns>The trimmed id, so the caller stores exactly what was validated.</returns>
    private static string ValidateNonPersonMentionId(NoteMention mention)
    {
        var id = mention.Id?.Trim() ?? string.Empty;

        var ok = mention.Type switch
        {
            NoteMention.TradeUnitType => TradeUnitIdPattern().IsMatch(id),
            NoteMention.TradeUnitGroupType or NoteMention.AppGroupType => NumericIdPattern().IsMatch(id),
            _ => false,
        };

        if (!ok)
            throw new ValidationException("mentions",
                $"Mention id '{mention.Id}' is not valid for a '{mention.Type}' mention.");

        return id;
    }

    // Trade unit codes are short alphanumerics (e.g. "3078", "4056"); dot/dash/underscore are
    // allowed as separators. No quotes, spaces or operators, which is what keeps $filter safe.
    [GeneratedRegex(@"^[A-Za-z0-9._-]{1,20}$")]
    private static partial Regex TradeUnitIdPattern();

    [GeneratedRegex(@"^[0-9]{1,10}$")]
    private static partial Regex NumericIdPattern();

    /// <inheritdoc />
    public Task DeleteAsync(long noteId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(noteId, _requestContext.GetCurrentUser(), cancellationToken);

    private async Task<List<NoteResponse>> MapWithNamesAsync(List<Note> notes, CancellationToken cancellationToken)
    {
        var nameMap = await _displayNameLookup.ResolveAsync(
            notes.Select(n => n.CreatedBy).Concat(notes.Select(n => n.ModifiedBy ?? string.Empty)),
            cancellationToken);
        return notes.Select(n => n.ToResponse(nameMap)).ToList();
    }

    private Task<Dictionary<string, string>> ResolveAsync(Note note, CancellationToken cancellationToken) =>
        _displayNameLookup.ResolveAsync(new[] { note.CreatedBy, note.ModifiedBy ?? string.Empty }, cancellationToken);
}
