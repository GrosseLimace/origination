using System.Text.Json;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class NoteService : INoteService
{
    private readonly INoteRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;

    public NoteService(
        INoteRepository repository,
        ICustomerRepository customerRepository,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
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

        Note note;
        try
        {
            note = await _repository.AddAsync(customerId, content, tradeUnit, SerializeMentions(mentions), _requestContext.GetCurrentUser(), cancellationToken);
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
        var note = await _repository.UpdateAsync(noteId, content, SerializeMentions(mentions), _requestContext.GetCurrentUser(), cancellationToken);
        return note is null ? null : note.ToResponse(await ResolveAsync(note, cancellationToken));
    }

    /// <summary>Normalizes then serializes the structured mentions to the JSON stored on the note.
    /// Null/empty → null so the column stays NULL rather than an empty "[]".
    /// <para>
    /// SECURITY (M-xxx / CWE-284): the persisted Mentions feed the Instant Share Note Logic App,
    /// which emails the note from the privileged shared mailbox to each person mention's address.
    /// A client-supplied person email is therefore an external-exfiltration vector, so we never
    /// trust it — a person's recipient address is ALWAYS derived from their id (the internal UPN),
    /// forcing an @scoular.com address. Trade-unit / group mentions never carry an email (recipients
    /// are re-resolved from the Entitlements DB at send time), so we strip it.
    /// </para></summary>
    private static string? SerializeMentions(IReadOnlyList<NoteMention>? mentions)
    {
        if (mentions is not { Count: > 0 }) return null;
        var normalized = mentions.Select(NormalizeMention).ToList();
        return JsonSerializer.Serialize(normalized);
    }

    /// <summary>Forces a person mention's email to the id-derived internal address (rejecting any
    /// client-supplied value) and drops emails from non-person mentions.</summary>
    private static NoteMention NormalizeMention(NoteMention mention)
    {
        if (!string.Equals(mention.Type, "person", StringComparison.OrdinalIgnoreCase))
            return mention with { Email = null };

        // The id is the person's UPN. If it already carries a domain use it as-is; otherwise it's a
        // short name → append the internal domain. Either way the address is provably @scoular.com,
        // never a client-controlled external address.
        var derived = mention.Id.Contains('@') ? mention.Id : $"{mention.Id}@scoular.com";
        return mention with { Email = derived };
    }

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
