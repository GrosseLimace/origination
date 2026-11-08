namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;

/// <summary>
/// The GraphQL document for a producer's CTRM splits (the field plan's fields). The rules every CTRM document
/// follows are in <c>CtrmQueries</c>.
/// </summary>
public static class CtrmSplitQueries
{
    /// <summary>Whether <see cref="SplitsByCustomer"/> has been confirmed against CTRM. Until it is,
    /// <c>Ctrm:SplitsSource</c> = <c>ctrm</c> is refused at startup.</summary>
    public const bool SplitsQueryConfirmed = false;

    /// <summary>
    /// A producer's splits (combined customer IDs). PLACEHOLDER: the root field and every field name are
    /// guesses from the CTRM Customer Splits Inquiry screen, because the API blocks introspection
    /// (<c>HC0046</c>) and the splits table hasn't been identified yet. Replace the document and
    /// <c>CtrmSplitDto</c> with the confirmed ones, then set <see cref="SplitsQueryConfirmed"/>.
    /// </summary>
    public const string SplitsByCustomer = """
        query ($customerId: String!) {
          customerSplits(customerId: $customerId, skip: 0, take: 500) {
            totalCount
            items { splitCustomerId primaryCustomerId name splitPercent effectiveDate expired siteType }
          }
        }
        """;
}
