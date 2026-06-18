using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Contract + pricing-line reads. Contract reads degrade to an empty list when the ODS
/// view is missing/unreachable; pricing-line reads degrade likewise.</summary>
public interface IContractService
{
    Task<List<ContractResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<ContractResponse>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<ContractResponse>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken);
    Task<List<ContractResponse>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<ContractResponse>> GetByFarmAsync(string farmId, CancellationToken cancellationToken);
    Task<List<ContractPricingLineResponse>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken);
    Task<List<ContractPricingLineResponse>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken);
}
