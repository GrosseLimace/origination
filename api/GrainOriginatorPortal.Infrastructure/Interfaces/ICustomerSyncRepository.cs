using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Data access for the nightly customer sync. Loads the ODS source rows and the (tracked) app-DB
/// state, stages inserts, reads the current-customer master for the manual-producer refresh, and
/// commits — while the orchestration (diffing, graduation rules, soft-delete guards, bring-back)
/// stays in CustomerSyncService. Load* and Add* and SaveChanges all run on one shared
/// ApplicationDbContext so the service's mutations to the returned entities persist.
/// </summary>
public interface ICustomerSyncRepository
{
    /// <summary>ODS source rows from originations.vw_CustomerTradeUnits (read-only).</summary>
    Task<List<CustomerTradeUnitView>> LoadOdsTradeUnitRowsAsync(CancellationToken cancellationToken);

    /// <summary>All app-DB customers, tracked so the service's mutations persist on SaveChanges.</summary>
    Task<List<Customer>> LoadAppCustomersAsync(CancellationToken cancellationToken);

    /// <summary>All app-DB customer-trade-unit rows, tracked.</summary>
    Task<List<CustomerTradeUnit>> LoadAppTradeUnitsAsync(CancellationToken cancellationToken);

    /// <summary>Reads the base.vw_CurrentCustomers master rows for the given customer ids
    /// (manual-producer refresh pass). Uses a long command timeout — the view is heavy.</summary>
    Task<List<CurrentCustomerRow>> LoadCurrentCustomerMasterAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);

    void AddCustomer(Customer customer);
    void AddTradeUnit(CustomerTradeUnit tradeUnit);

    Task SaveChangesAsync(CancellationToken cancellationToken);
}
