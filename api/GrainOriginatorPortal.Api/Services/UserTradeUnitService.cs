using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UserTradeUnitService : IUserTradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly ICustomerRepository _customerRepository;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<UserTradeUnitService> _logger;

    public UserTradeUnitService(
        IEntitlementsRepository entitlements,
        ICustomerRepository customerRepository,
        IRequestContextService requestContext,
        ILogger<UserTradeUnitService> logger)
    {
        _entitlements = entitlements;
        _customerRepository = customerRepository;
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
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements DB unavailable for user {UserId} — falling back to all trade units from dbo.CustomerTradeUnit", userId);
            var units = await _customerRepository.GetAllActiveTradeUnitCodesAsync(cancellationToken);
            if (units.Count == 0) return [];
            return [new UserTradeUnitGroupResponse { GroupName = "All Trade Units", TradeUnitCodes = units }];
        }
    }
}
