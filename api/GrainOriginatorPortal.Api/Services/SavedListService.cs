using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class SavedListService : ISavedListService
{
    private readonly ISavedListRepository _repository;
    private readonly IEntitlementsRepository _entitlements;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IRequestContextService _requestContext;

    public SavedListService(
        ISavedListRepository repository,
        IEntitlementsRepository entitlements,
        IDisplayNameLookupRepository displayNameLookup,
        IUserEntitlementService entitlementService,
        IRequestContextService requestContext)
    {
        _repository = repository;
        _entitlements = entitlements;
        _displayNameLookup = displayNameLookup;
        _entitlementService = entitlementService;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<List<SavedListResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        var lists = await _repository.GetByUserAsync(_requestContext.GetCurrentUser(), cancellationToken);
        return await ToResponsesAsync(lists, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<List<SavedListResponse>> GetTeamListsAsync(string? tradeUnitsCsv, CancellationToken cancellationToken)
    {
        var scoped = await ScopeToAllowedTradeUnitsAsync(tradeUnitsCsv, cancellationToken);
        if (scoped.Length == 0) return new List<SavedListResponse>();

        var lists = await _repository.GetByTradeUnitsAsync(scoped, _requestContext.GetCurrentUser(), cancellationToken);
        return await ToResponsesAsync(lists, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<List<TeamMemberResponse>> GetTeamMembersAsync(string? tradeUnitsCsv, CancellationToken cancellationToken)
    {
        var scoped = await ScopeToAllowedTradeUnitsAsync(tradeUnitsCsv, cancellationToken);
        if (scoped.Length == 0) return new List<TeamMemberResponse>();

        var caller = _requestContext.GetCurrentUserShortName();
        var rows = await _entitlements.GetUsersByTradeUnitsAsync(scoped, cancellationToken);
        return rows
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId)
                && !string.Equals(r.UserId, caller, StringComparison.OrdinalIgnoreCase))
            .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase)
            .Select(g => new TeamMemberResponse
            {
                UserId = g.Key,
                DisplayName = g.Select(r => r.DisplayName).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? g.Key
            })
            .OrderBy(m => m.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<List<SavedListResponse>> AssignAsync(IReadOnlyList<string> targetUserIds, string name, string query,
        string? tradeUnits, string? filters, string? includedCustomerIds, string? excludedCustomerIds, CancellationToken cancellationToken)
    {
        await ValidateTradeUnitsAsync(tradeUnits, cancellationToken);

        // Only assign to members who actually belong to the list's (entitlement-scoped) trade units —
        // a target id supplied by the client that isn't in the manager's TUs is silently dropped.
        var scoped = await ScopeToAllowedTradeUnitsAsync(tradeUnits, cancellationToken);
        if (scoped.Length == 0) return new List<SavedListResponse>();

        var members = await _entitlements.GetUsersByTradeUnitsAsync(scoped, cancellationToken);
        var allowedTargets = new HashSet<string>(members.Select(m => m.UserId), StringComparer.OrdinalIgnoreCase);

        var caller = _requestContext.GetCurrentUser();
        // Members come from the entitlements picker as short UPNs (e.g. "CEgr"); store AssignedTo as the
        // full UPN (e.g. "CEgr@scoular.com") to match CreatedBy's format and the recipient's token identity.
        // The tenant domain is taken from the acting manager's own UPN (same directory).
        var domain = caller.Contains('@') ? caller[(caller.IndexOf('@') + 1)..] : null;
        var now = DateTime.UtcNow;
        var copies = targetUserIds
            .Where(t => !string.IsNullOrWhiteSpace(t) && allowedTargets.Contains(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(target => new SavedList
            {
                Name = name,
                Query = query,
                TradeUnits = tradeUnits,
                Filters = filters,
                IncludedCustomerIds = includedCustomerIds,
                ExcludedCustomerIds = excludedCustomerIds,
                CreatedBy = caller,
                CreatedAt = now,
                AssignedTo = ToFullUpn(target, domain)
            })
            .ToList();

        if (copies.Count == 0) return new List<SavedListResponse>();

        await _repository.AddRangeAsync(copies, cancellationToken);
        return await ToResponsesAsync(copies, cancellationToken);
    }

    /// <summary>Resolves CreatedBy / ModifiedBy / AssignedTo display names for a set of lists and maps to responses.</summary>
    private async Task<List<SavedListResponse>> ToResponsesAsync(List<SavedList> lists, CancellationToken cancellationToken)
    {
        var nameMap = await _displayNameLookup.ResolveAsync(
            lists.Select(l => l.CreatedBy)
                .Concat(lists.Select(l => l.ModifiedBy ?? string.Empty))
                .Concat(lists.Select(l => l.AssignedTo ?? string.Empty)),
            cancellationToken);
        return lists.Select(l => l.ToResponse(nameMap)).ToList();
    }

    /// <summary>Expands a short UPN ("CEgr") to a full UPN ("CEgr@domain") using the given tenant domain.
    /// Returns the value unchanged when it already contains '@' or no domain is available.</summary>
    private static string ToFullUpn(string shortOrFull, string? domain) =>
        shortOrFull.Contains('@') || string.IsNullOrEmpty(domain) ? shortOrFull : $"{shortOrFull}@{domain}";

    /// <summary>Parses a trade-unit CSV and intersects it with the caller's entitled trade units
    /// (defense in depth — the UI already bounds the request to the manager's TUs).</summary>
    private async Task<string[]> ScopeToAllowedTradeUnitsAsync(string? tradeUnitsCsv, CancellationToken cancellationToken)
    {
        var requested = (tradeUnitsCsv ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (requested.Length == 0) return Array.Empty<string>();

        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        return requested.Where(allowed.Contains).ToArray();
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
            new[] { list.CreatedBy, list.ModifiedBy ?? string.Empty, list.AssignedTo ?? string.Empty }, cancellationToken);
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
