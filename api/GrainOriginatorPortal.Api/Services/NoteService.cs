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
    public async Task<List<NoteResponse>> GetAllAsync(string? tradeUnits, int? sinceDays, CancellationToken cancellationToken)
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
        var notes = await _repository.GetAsync(tuList, createdSinceUtc, cancellationToken);
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

    /// <summary>Serializes the structured mentions to the JSON stored on the note. Null/empty → null
    /// so the column stays NULL rather than an empty "[]".</summary>
    private static string? SerializeMentions(IReadOnlyList<NoteMention>? mentions) =>
        mentions is { Count: > 0 } ? JsonSerializer.Serialize(mentions) : null;

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
