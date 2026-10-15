using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Delivery-ticket reads. All methods degrade to an empty list when the ODS ticket view
/// is missing/unreachable (e.g. some Dev environments) rather than failing the request.</summary>
public interface ITicketService
{
    Task<List<TicketResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<TicketResponse>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<TicketResponse>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<TicketResponse>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<TicketResponse>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken);
    Task<List<TicketResponse>> GetByFarmAsync(string farmId, CancellationToken cancellationToken);
}
