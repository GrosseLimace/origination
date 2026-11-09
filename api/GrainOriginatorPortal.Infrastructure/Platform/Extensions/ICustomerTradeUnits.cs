namespace GrainOriginatorPortal.Infrastructure.Platform.Extensions;

/// <summary>
/// Which trade units customers belong to. Platform needs it: the per-customer access check compares a customer's
/// trade units with the caller's, and the trade-unit catalog falls back to every trade unit some customer is in when
/// the entitlements database is unavailable. Customer trade units belong to the Customers module, which implements it.
/// </summary>
/// <remarks>
/// There is no fallback. If no module provides this, resolving the services that use it fails loudly.
/// </remarks>
public interface ICustomerTradeUnits
{
    /// <summary>
    /// The distinct trade-unit codes a customer belongs to, from <c>dbo.CustomerTradeUnit</c>: active rows, manual
    /// assignments included, trimmed, blanks left out.
    /// </summary>
    Task<List<string>> GetActiveCodesAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>Every distinct active trade-unit code any customer has, ordered.</summary>
    Task<List<string>> GetAllActiveCodesAsync(CancellationToken cancellationToken);
}
