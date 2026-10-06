using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// A feeder for the nightly customer sync. Returns rows shaped like <c>vw_CustomerTradeUnits</c> plus
/// the manual-producer master lookup, so <c>CustomerSyncService</c> runs the same passes whichever
/// source is configured (<see cref="CustomerSyncSources"/>).
/// </summary>
public interface ICustomerSyncSource
{
    /// <summary><see cref="CustomerSyncSources.Ods"/> or <see cref="CustomerSyncSources.Ctrm"/>.</summary>
    string Name { get; }

    Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken);
}

/// <summary>
/// The app-DB state the sync loaded (tracked) before asking the source for rows. Sources read it only
/// (e.g. to find the manual customers to look up in the master); the service owns every mutation.
/// </summary>
public sealed class CustomerSyncAppState
{
    public required IReadOnlyList<Customer> Customers { get; init; }
    public required IReadOnlyList<CustomerTradeUnit> TradeUnits { get; init; }
}

/// <summary>Per-run options a source honours.</summary>
public sealed class CustomerSyncLoadOptions
{
    public bool DryRun { get; init; }
    public DateTime? DiscoveryFrom { get; init; }

    public static readonly CustomerSyncLoadOptions Default = new();
}
