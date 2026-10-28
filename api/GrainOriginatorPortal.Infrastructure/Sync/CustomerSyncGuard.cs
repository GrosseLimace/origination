// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>Limits for <see cref="CustomerSyncGuard"/>, read per run from configuration.</summary>
public sealed record CustomerSyncGuardLimits(int MaxDeactivationPercent, int MaxDeactivationCount)
{
    public const string PercentKey = "CustomerSync:MaxDeactivationPercent";
    public const string CountKey = "CustomerSync:MaxDeactivationCount";

    public static CustomerSyncGuardLimits FromConfiguration(IConfiguration c) =>
        new(Math.Clamp(CtrmConfig.ReadInt(c, PercentKey, 5), 0, 100), Math.Max(0, CtrmConfig.ReadInt(c, CountKey, 500)));
}

/// <summary>Outcome of <see cref="CustomerSyncGuard.Evaluate"/>; carries the counts it judged for reporting.</summary>
public sealed record CustomerSyncGuardVerdict(
    bool Tripped, string? Reason, int SourceRows, int ActiveCustomersBefore, int CustomersToDeactivate,
    int ActiveLinksBefore, int LinksToDeactivate);

/// <summary>
/// Pure mass-deactivation rule applied to both sync sources before any write. Trips when the source
/// returned nothing while the app holds active rows, or when customers or links to deactivate exceed
/// the absolute count or the percentage of the active total. Percentages use integer math only.
/// </summary>
public static class CustomerSyncGuard
{
    public static CustomerSyncGuardVerdict Evaluate(
        int sourceRows, int activeCustomersBefore, int customersToDeactivate,
        int activeLinksBefore, int linksToDeactivate, CustomerSyncGuardLimits limits)
    {
        string? reason = null;

        if (sourceRows == 0 && (activeCustomersBefore > 0 || activeLinksBefore > 0))
        {
            reason = $"source returned no rows while the app holds {activeCustomersBefore} active customers / {activeLinksBefore} active links";
        }
        else if (Exceeds(customersToDeactivate, activeCustomersBefore, limits))
        {
            reason = $"customers: {customersToDeactivate} of {activeCustomersBefore} active would be deactivated, limit {limits.MaxDeactivationCount} rows / {limits.MaxDeactivationPercent}%";
        }
        else if (Exceeds(linksToDeactivate, activeLinksBefore, limits))
        {
            reason = $"links: {linksToDeactivate} of {activeLinksBefore} active would be deactivated, limit {limits.MaxDeactivationCount} rows / {limits.MaxDeactivationPercent}%";
        }

        return new CustomerSyncGuardVerdict(reason is not null, reason, sourceRows,
            activeCustomersBefore, customersToDeactivate, activeLinksBefore, linksToDeactivate);
    }

    private static bool Exceeds(int toDeactivate, int activeBefore, CustomerSyncGuardLimits limits) =>
        toDeactivate > limits.MaxDeactivationCount
        || (long)toDeactivate * 100 > (long)activeBefore * limits.MaxDeactivationPercent;
}
