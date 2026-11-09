namespace GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions;

/// <summary>
/// Which trade units a producer still has open activity in: an open purchase contract, or an unapplied
/// ticket. Customers uses it to decide which trade-unit memberships are locked, but the activity itself is
/// contract and ticket data, so the Contracts module implements it.
/// </summary>
/// <remarks>
/// Customers has no fallback. If no module provides this, resolving the customer repository fails loudly
/// rather than treating every trade unit as dormant and offering to remove it.
/// </remarks>
public interface ICustomerActivitySource
{
    /// <summary>
    /// The trade units in which the producer with this code has an open contract or an unapplied ticket.
    /// Trimmed, compared case-insensitively, and empty for a blank code.
    /// </summary>
    Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken);
}
