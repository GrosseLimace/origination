using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Customer/producer reads + writes and trade-unit membership management. List reads
/// degrade to an empty list on DB errors; the trade-unit writes return the repository's outcome
/// enum so the controller can map it to the right HTTP status.</summary>
public interface ICustomerService
{
    Task<List<CustomerResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<CustomerResponse>> SearchAsync(string searchTerm, List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<CustomerResponse>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken);
    Task<CustomerResponse?> GetByIdAsync(long id, CancellationToken cancellationToken);
    Task<CustomerResponse?> GetByScoularIdAsync(string scoularId, CancellationToken cancellationToken);
    Task<List<CustomerResponse>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken);

    /// <summary>Applies the (no-op) contact update and returns the refreshed customer, or null if not found.</summary>
    Task<CustomerResponse?> UpdateAsync(long id, string location, string phone, string email,
        List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken);

    Task<List<CustomerTradeUnitInfo>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken);
    Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken);
    Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken);
}
