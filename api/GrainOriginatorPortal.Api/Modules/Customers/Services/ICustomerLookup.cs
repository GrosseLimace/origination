// Project namespaces
using GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

namespace GrainOriginatorPortal.Api.Modules.Customers.Services;

/// <summary>
/// What other modules may ask the Customers module about customers. They use this instead of the Customers
/// repository, so the customer master's rules (active rows, trade-unit memberships, enrichment) stay in one place.
/// </summary>
public interface ICustomerLookup
{
    /// <summary>The active customers in any of <paramref name="tradeUnits"/>: the scope a list is cut to.</summary>
    Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken);

    /// <summary>The customer's active trade-unit codes, ordered.</summary>
    Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>The customer's name and CTRM code, or null when there is no such customer.</summary>
    Task<CustomerName?> GetNameAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>
    /// The name and CTRM code of each of <paramref name="customerIds"/> that exists, active or not: a report about past
    /// activity still names a customer who has since been deactivated. Ids with no customer are left out.
    /// </summary>
    Task<Dictionary<long, CustomerName>> GetNamesAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);

    /// <summary>
    /// The active customers among <paramref name="customerIds"/>, as the customer list shows them (e-sign, ACH and
    /// trade units filled in). A database outage is a 503 <c>CUSTOMERS_DB_UNAVAILABLE</c>.
    /// </summary>
    Task<List<CustomerResponse>> GetActiveAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken);
}

/// <summary>A customer's name and CTRM code (<c>Customer.ScoularId</c>).</summary>
public sealed record CustomerName(string Name, string? ScoularId);
