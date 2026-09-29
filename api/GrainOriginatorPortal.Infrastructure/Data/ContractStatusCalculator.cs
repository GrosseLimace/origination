using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Contract post-processing that is NOT read from any data source — it is derived in the
/// application from the ship-window dates. Extracted so the ODS and CTRM repositories share one
/// implementation.
/// </summary>
/// <remarks>
/// This matters more than it looks. Contract status drives the Past Due badge, the Unshipped
/// Bushels insight and the status column, and none of it comes from a source system — both
/// repositories compute it. If each had its own copy, flipping the CTRM feature flag could change
/// what a producer's contracts look like for reasons that have nothing to do with the underlying
/// data, which would make any comparison between the two sources meaningless.
/// </remarks>
public static class ContractStatusCalculator
{
    /// <summary>
    /// Rewrites the min-date sentinel to null so "open" reads as an absent closed date.
    /// </summary>
    /// <remarks>
    /// Db2 represents an unset date as 0001-01-01 rather than NULL, and that convention reaches us
    /// through both paths: the ODS view carries it on some source rows, and the CTRM GraphQL API
    /// returns it too. Callers therefore treat "closed" as <c>ClosedDate != null</c> only after
    /// this has run.
    /// </remarks>
    public static void NormalizeOpenClosedDates(IEnumerable<Contract> contracts)
    {
        foreach (var c in contracts)
            if (c.ClosedDate.HasValue && c.ClosedDate.Value <= OdsConstants.OpenClosedDateSentinel)
                c.ClosedDate = null;
    }

    /// <summary>
    /// Derives lifecycle status from the delivery window relative to <paramref name="today"/>.
    /// </summary>
    /// <remarks>
    /// Only ever returns Pending, Active or Overdue. Fulfilled would require ticket data to prove
    /// 100% delivery, and Cancelled has no source signal — so neither is currently reachable, which
    /// is worth knowing because some callers still guard against them.
    /// </remarks>
    public static ContractStatus Calculate(Contract contract, DateTime today)
    {
        // NOTE: Fulfilled status requires ticket data to calculate delivery progress
        // Once tickets are available, check if 100% delivered and return Fulfilled

        // Check delivery period dates
        if (contract.DeliveryStart.HasValue && contract.DeliveryEnd.HasValue)
        {
            // If today is before delivery period starts, it's pending
            if (today < contract.DeliveryStart.Value)
            {
                return ContractStatus.Pending;
            }

            // If today is within the delivery period, it's active
            if (today >= contract.DeliveryStart.Value && today <= contract.DeliveryEnd.Value)
            {
                return ContractStatus.Active;
            }

            // If delivery period has passed, it's overdue (until we can verify fulfillment via tickets)
            if (today > contract.DeliveryEnd.Value)
            {
                return ContractStatus.Overdue;
            }
        }

        // Default to pending for contracts without delivery dates
        return ContractStatus.Pending;
    }
}
