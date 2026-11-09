using GrainOriginatorPortal.Infrastructure.Platform.Extensions;
using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Platform.Preferences.Interfaces;

namespace GrainOriginatorPortal.Api.Platform.Preferences;

/// <inheritdoc />
public class TradeUnitService : ITradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly ICustomerTradeUnits _customerTradeUnits;
    private readonly ILogger<TradeUnitService> _logger;

    public TradeUnitService(
        IEntitlementsRepository entitlements,
        ICustomerTradeUnits customerTradeUnits,
        ILogger<TradeUnitService> logger)
    {
        _entitlements = entitlements;
        _customerTradeUnits = customerTradeUnits;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<TradeUnitOptionResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        try
        {
            var rows = await _entitlements.GetAllAsync(cancellationToken);
            return rows
                .GroupBy(r => r.TradeUnitCode, StringComparer.OrdinalIgnoreCase)
                .Select(g => new TradeUnitOptionResponse
                {
                    Code = g.Key,
                    Description = g.Select(x => x.Description).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d)),
                })
                .OrderBy(o => o.Code, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements TU catalog unavailable — falling back to dbo.CustomerTradeUnit");
            var codes = await _customerTradeUnits.GetAllActiveCodesAsync(cancellationToken);
            return codes.Select(c => new TradeUnitOptionResponse { Code = c }).ToList();
        }
    }
}
