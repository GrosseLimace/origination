using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read access to purchase contracts and pricing lines from the ODS (base.vw_CurrentContracts /
/// base.Contract / base.vw_ContractPricing). Methods return the happy-path result with status
/// computed and open/closed dates normalized; the caller owns the SqlException → empty-list
/// fallbacks and trace-id error logging.
/// </summary>
public interface IContractRepository
{
    Task<List<Contract>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Contract>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<Contract>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken);
    Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Contract>> GetByFarmAsync(string farmId, CancellationToken cancellationToken);
    Task<List<Contract>> GetBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken);
    Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken);
    Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken);
}
