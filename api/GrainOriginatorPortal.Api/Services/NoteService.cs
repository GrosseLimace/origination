using GrainOriginatorPortal.Api.Exceptions;
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
    private readonly IUserEntitlementService _entitlementService;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;

    public NoteService(
        INoteRepository repository,
        ICustomerRepository customerRepository,
        IUserEntitlementService entitlementService,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _entitlementService = entitlementService;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<List<NoteResponse>> GetAllAsync(string? tradeUnits, CancellationToken cancellationToken)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var notes = await _repository.GetAsync(tuList, cancellationToken);

        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new GrainOriginatorPortal.Api.Exceptions.InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        notes = notes.Where(n => n.TradeUnit == null || allowed.Contains(n.TradeUnit)).ToList();

        return await MapWithNamesAsync(notes, cancellationToken);
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
    public async Task<NoteResponse> CreateAsync(long customerId, string content, CancellationToken cancellationToken)
    {
        // Derive TradeUnit from the authoritative dbo.CustomerTradeUnit rather than trusting the
        // client. Prevents a caller from assigning a foreign trade unit to manipulate note visibility.
        // (Logic moved out of NotesController.Create so the controller no longer touches a DbContext.)
        var tradeUnit = await _customerRepository.GetFirstActiveTradeUnitAsync(customerId, cancellationToken);

        Note note;
        try
        {
            note = await _repository.AddAsync(customerId, content, tradeUnit, _requestContext.GetCurrentUser(), cancellationToken);
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
    public async Task<NoteResponse?> UpdateAsync(long noteId, string content, CancellationToken cancellationToken)
    {
        var note = await _repository.UpdateAsync(noteId, content, _requestContext.GetCurrentUser(), cancellationToken);
        return note is null ? null : note.ToResponse(await ResolveAsync(note, cancellationToken));
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
