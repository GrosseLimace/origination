using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class TradeUnitService : ITradeUnitService
{
    private readonly IEntitlementsRepository _entitlements;
    private readonly ICustomerRepository _customerRepository;
    private readonly ILogger<TradeUnitService> _logger;

    public TradeUnitService(
        IEntitlementsRepository entitlements,
        ICustomerRepository customerRepository,
        ILogger<TradeUnitService> logger)
    {
        _entitlements = entitlements;
        _customerRepository = customerRepository;
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
            var codes = await _customerRepository.GetAllActiveTradeUnitCodesAsync(cancellationToken);
            return codes.Select(c => new TradeUnitOptionResponse { Code = c }).ToList();
        }
    }
}
