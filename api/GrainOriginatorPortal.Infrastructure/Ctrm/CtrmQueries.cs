namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// What every CTRM GraphQL document has in common: the gateway's rules, and the limits more than one module
/// needs. The documents themselves live with the module that sends them: <see cref="CtrmContractQueries"/>
/// for contracts and tickets, <c>CtrmCustomerQueries</c> in Customers and <c>CtrmSplitQueries</c> in Producers.
/// </summary>
/// <remarks>
/// <b>No '#' comment lines in any document.</b> The Application Gateway WAF in front of this API has been
/// observed rejecting request bodies that contain them — OWASP rules read '#' as a SQL comment sequence — and
/// it answers with an HTML 403 the API never sees. Explain things in C# comments outside the string, never
/// inside the query.
/// </remarks>
public static class CtrmQueries
{
    /// <summary>
    /// Maximum bill-of-lading range the <c>tickets</c> field accepts.
    /// </summary>
    /// <remarks>
    /// Server-enforced, not a convention: a wider range is rejected outright with
    /// <c>"BL-date range must not exceed 366 days"</c> and <c>extensions.code = VALIDATION</c>. Unlike
    /// <c>contracts</c>, which happily accepts a 425-day window.
    /// </remarks>
    public const int MaxTicketRangeDays = 366;
}
