using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UserTradeUnitService : IUserTradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<UserTradeUnitService> _logger;

    public UserTradeUnitService(
        IEntitlementsRepository entitlements,
        IRequestContextService requestContext,
        ILogger<UserTradeUnitService> logger)
    {
        _entitlements = entitlements;
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
            return rows
                .Select(u => new { GroupName = u.GroupName ?? "Default", u.TradeUnitCode })
                .Distinct()
                .GroupBy(u => u.GroupName)
                .OrderBy(g => g.Key)
                .Select(g => new UserTradeUnitGroupResponse
                {
                    GroupName = g.Key,
                    TradeUnitCodes = g.Select(u => u.TradeUnitCode).Distinct().OrderBy(c => c).ToList()
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
