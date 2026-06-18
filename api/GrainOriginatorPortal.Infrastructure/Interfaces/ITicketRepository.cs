using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Read access to delivery tickets from the ODS (base.vw_CurrentTickets) plus quality/elevator
/// enrichment and customer-storage gating. Methods return the happy-path result; the caller owns
/// the SqlException → empty-list fallbacks and trace-id error logging.
/// </summary>
public interface ITicketRepository
{
    Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken);
    Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken);
    Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken);
    Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken);

    /// <summary>
    /// Commodity codes each customer currently holds in active customer storage, keyed by Scoular
    /// customer code. Exposed so callers that load their own ticket sets (e.g. open-activity TU
    /// derivation) can apply the same C-prefix storage gate.
    /// </summary>
    Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken);

    /// <summary>Drops customer-storage (C-prefix) tickets whose grain is no longer in active storage.</summary>
    List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer);
}
