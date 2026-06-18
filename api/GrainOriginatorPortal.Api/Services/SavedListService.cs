using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class SavedListService : ISavedListService
{
    private readonly ISavedListRepository _repository;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IRequestContextService _requestContext;

    public SavedListService(
        ISavedListRepository repository,
        IDisplayNameLookupRepository displayNameLookup,
        IUserEntitlementService entitlementService,
        IRequestContextService requestContext)
    {
        _repository = repository;
        _displayNameLookup = displayNameLookup;
        _entitlementService = entitlementService;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<List<SavedListResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        var lists = await _repository.GetByUserAsync(_requestContext.GetCurrentUser(), cancellationToken);
        var nameMap = await _displayNameLookup.ResolveAsync(
            lists.Select(l => l.CreatedBy).Concat(lists.Select(l => l.ModifiedBy ?? string.Empty)),
            cancellationToken);
        return lists.Select(l => l.ToResponse(nameMap)).ToList();
    }

    /// <inheritdoc />
    public async Task<List<SavedListResponse>> GetTeamListsAsync(string? tradeUnitsCsv, CancellationToken cancellationToken)
    {
        var requested = (tradeUnitsCsv ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (requested.Length == 0) return new List<SavedListResponse>();

        // Defense in depth: only ever query trade units the caller is actually entitled to, even though
        // the build-list selector already bounds the request to the manager's TUs.
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        var scoped = requested.Where(allowed.Contains).ToArray();
        if (scoped.Length == 0) return new List<SavedListResponse>();

        var lists = await _repository.GetByTradeUnitsAsync(scoped, _requestContext.GetCurrentUser(), cancellationToken);
        var nameMap = await _displayNameLookup.ResolveAsync(
            lists.Select(l => l.CreatedBy).Concat(lists.Select(l => l.ModifiedBy ?? string.Empty)),
            cancellationToken);
        return lists.Select(l => l.ToResponse(nameMap)).ToList();
    }

    /// <inheritdoc />
    public async Task<SavedListResponse> CreateAsync(string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        await ValidateTradeUnitsAsync(tradeUnits, cancellationToken);

        var savedList = new SavedList
        {
            Name = name,
            Query = query,
            TradeUnits = tradeUnits,
            Filters = filters,
            IncludedCustomerIds = includedCustomerIds,
            ExcludedCustomerIds = excludedCustomerIds,
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow
        };
        await _repository.AddAsync(savedList, cancellationToken);

        var nameMap = await _displayNameLookup.ResolveAsync(new[] { savedList.CreatedBy }, cancellationToken);
        return savedList.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<SavedListResponse?> UpdateAsync(int listId, string name, string query, string? tradeUnits, string? filters,
        string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        await ValidateTradeUnitsAsync(tradeUnits, cancellationToken);

        var list = await _repository.UpdateAsync(listId, _requestContext.GetCurrentUser(), _requestContext.IsAdmin(),
            name, query, tradeUnits, filters, includedCustomerIds, excludedCustomerIds, cancellationToken);
        if (list == null) return null;

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { list.CreatedBy, list.ModifiedBy ?? string.Empty }, cancellationToken);
        return list.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public Task DeleteAsync(int listId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(listId, _requestContext.GetCurrentUser(), _requestContext.IsAdmin(), cancellationToken);

    /// <summary>Validates the CSV of requested trade units against the caller's entitlements (throws
    /// when one is not allowed). No-op when the request carries no trade units.</summary>
    private async Task ValidateTradeUnitsAsync(string? tradeUnits, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(tradeUnits)) return;

        var codes = tradeUnits.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (codes.Length > 0)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(codes, cancellationToken);
    }
}
