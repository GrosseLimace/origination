using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UserTradeUnitService : IUserTradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly IMbpLocationSynonymRepository _locations;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<UserTradeUnitService> _logger;

    public UserTradeUnitService(
        IEntitlementsRepository entitlements,
        IMbpLocationSynonymRepository locations,
        IRequestContextService requestContext,
        ILogger<UserTradeUnitService> logger)
    {
        _entitlements = entitlements;
        _locations = locations;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<UserTradeUnitGroupResponse>> GetForCurrentUserAsync(CancellationToken cancellationToken)
    {
        var userId = _requestContext.GetCurrentUserShortName();
        if (string.IsNullOrWhiteSpace(userId))
            return [];

        try
        {
            var rows = await _entitlements.GetByUserAsync(userId, cancellationToken);

            // The location shown next to each trade unit comes from dbo.MbpLocationSynonym (the MBPLOCSYN
            // master): the trade unit code IS a bare LocationId (e.g. "2115" -> "2115"; NOT the composite
            // "2115-ADRIAN"), resolved to its curated DisplayName (e.g. "Adrian, MO"). Codes with no
            // matching row get no location text — the selector shows just the code. This replaces the
            // former entitlements-view Description as the location source.
            var grouped = rows
                .Select(u => new { GroupName = u.GroupName ?? "Default", u.TradeUnitCode })
                .GroupBy(u => u.GroupName)
                .OrderBy(g => g.Key)
                .ToList();

            var allCodes = grouped
                .SelectMany(g => g.Select(u => u.TradeUnitCode))
                .Where(c => !string.IsNullOrWhiteSpace(c))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var displayNames = await _locations.GetDisplayNamesByLocationIdsAsync(allCodes, cancellationToken);

            return grouped
                .Select(g =>
                {
                    // Dedupe by code within the group; location = DisplayName for the bare LocationId
                    // (the trade unit code), or blank when the master has no row for that code.
                    var units = g
                        .GroupBy(u => u.TradeUnitCode)
                        .Select(cg => new TradeUnitOptionResponse
                        {
                            Code = cg.Key,
                            Description = displayNames.GetValueOrDefault(cg.Key?.Trim() ?? string.Empty)
                        })
                        .OrderBy(o => o.Code)
                        .ToList();
                    return new UserTradeUnitGroupResponse
                    {
                        GroupName = g.Key,
                        TradeUnitCodes = units.Select(u => u.Code).ToList(),
                        TradeUnits = units
                    };
                })
                .ToList();
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            // Fail closed on an Entitlements DB outage: return no trade units rather than falling
            // open to ALL trade unit codes (CWE-285). Previously this fell back to every active code
            // from dbo.CustomerTradeUnit, which leaked the full org trade-unit structure to any user
            // during a transient outage. Empty is consistent with the cold-outage behavior of
            // UserEntitlementService.GetAllowedTradeUnitCodesAsync and lets the selector show an
            // "unavailable" state instead of an unentitled list.
            _logger.LogError(ex,
                "Entitlements DB unavailable for user {UserId} — failing closed (no trade units). [{ErrorCode}]",
                userId, "ENTITLEMENTS_DB_UNAVAILABLE");
            return [];
        }
    }
}
