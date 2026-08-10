using System.Text;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// GraphQL documents for the CTRM API.
/// </summary>
/// <remarks>
/// <para><b>No '#' comment lines in any document here.</b> The Application Gateway WAF in front of
/// this API has been observed rejecting request bodies that contain them — OWASP rules read '#' as a
/// SQL comment sequence — and it answers with an HTML 403 the API never sees. Explain things in C#
/// comments outside the string, never inside the query.</para>
///
/// <para>Every field named below was verified against live QA data during the AB#32062 pass. The
/// projection is deliberately limited to what the portal reads: this API resolves child collections
/// per-field via DataLoader, so asking for fields we discard costs real time.</para>
/// </remarks>
public static class CtrmQueries
{
    /// <summary>
    /// One page of contracts over a contract-date window, with pricing lines.
    /// Variables: <c>$from</c>, <c>$to</c> (Date!), <c>$skip</c>, <c>$take</c> (Int!).
    /// </summary>
    /// <remarks>
    /// The date window is the ONLY filter available — there is no customerId argument and no
    /// contractPrefixType argument, so purchase-only filtering happens after the fetch. That
    /// limitation is why contracts are served from a cached window snapshot rather than queried
    /// per producer.
    /// </remarks>
    public const string ContractsPage = """
        query ($from: Date!, $to: Date!, $skip: Int!, $take: Int!) {
          contracts(skip: $skip, take: $take, contractDateFrom: $from, contractDateTo: $to) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
              contractId contractPrefixType contractNumber
              customerId customerName tradeUnit
              commodityCode commodityDescription commodityGroup
              contractDate startShipDate finalShipDate closedDate cropYear
              quantity quantityUom totalValue
              pricedQuantity openBalanceQuantity settledQuantity
              priceTypeCode specialType customerConfirmStatus
              marketZone basisLocation
              hedgeMarketMonthDescription priceMarketMonthDescription
              prices {
                priceSequence priceQuantity priceUom
                flatPrice basisPrice hedgePrice freightAdjustment
                priceDate priceCurrency
                traderInitials trader
                priceOpenQuantity priceAppliedQuantity priceSettledQuantity
                priceOpenWeight priceAppliedWeight priceSettledWeight
                customerConfirmStatus brokerConfirmStatus
                lastActivityTimestamp
              }
            }
          }
        }
        """;

    /// <summary>
    /// Cheapest possible probe: one contract row over the configured window. Used by the
    /// diagnostics endpoint to prove auth, egress and data access in a single call.
    /// </summary>
    /// <remarks>
    /// This replaced an introspection-based probe. Introspection was available when the API was
    /// first validated but the QA gateway now rejects it with <c>HC0046</c>
    /// ("Introspection is not allowed for the current request"), so a probe built on it would report
    /// a failure that says nothing about whether the integration works.
    /// </remarks>
    public const string ContractsProbe = """
        query ($from: Date!, $to: Date!) {
          contracts(skip: 0, take: 1, contractDateFrom: $from, contractDateTo: $to) {
            totalCount
            items { contractId customerId contractDate }
          }
        }
        """;

    /// <summary>
    /// Maximum bill-of-lading range the <c>tickets</c> field accepts.
    /// </summary>
    /// <remarks>
    /// Server-enforced, not a convention: a wider range is rejected outright with
    /// <c>"BL-date range must not exceed 366 days"</c> and <c>extensions.code = VALIDATION</c>. Unlike
    /// <c>contracts</c>, which happily accepts a 425-day window.
    /// </remarks>
    public const int MaxTicketRangeDays = 366;

    /// <summary>
    /// One page of tickets over a bill-of-lading date window, with detail rows.
    /// </summary>
    /// <remarks>
    /// The date range is the only filter — no customer and no contract argument — so the producer
    /// scoping happens after the fetch, against <c>details.customerCode</c>. Same shape as the contract
    /// window for the same reason.
    /// </remarks>
    public const string TicketsPage = """
        query ($from: Date!, $to: Date!, $skip: Int!, $take: Int!) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
              ticketPrefix ticketNumber ticketSuffix ticketBLDate productCode
              shipmentTicketNumber loadOrganizationCode unloadOrganizationCode loadElevatorCode
              unloadQuantity loadoutQuantity
              details {
                ticketSequenceNumber
                customerCode organizationCode elevatorCode gradeCode
                contractNumber ticketType
                ticketStatusCode ticketStatusDescription
                appliedGrossQuantity appliedNetQuantity appliedDockQuantity appliedShrinkQuantity
                finalSettledNetQuantity finalSettledDate ticketLastChangeDate
                gradeFactorMoisturePercent gradeFactorTestWeightPercent gradeFactorProteinPercent
                storageProgramCode cancelFlag priceSequence
              }
            }
          }
        }
        """;

    /// <summary>Projection used for every single-ticket lookup.</summary>
    /// <remarks>
    /// The <c>gradeFactor*</c> fields sit on the detail row here. Our ODS path reads the same values
    /// from <c>base.vw_TicketQuality</c> and joins them back by ticket id, so taking them inline
    /// removes a view and a join.
    /// </remarks>
    private const string TicketProjection = """
        ticketPrefix ticketNumber ticketSuffix ticketBLDate productCode
        shipmentTicketNumber loadOrganizationCode unloadOrganizationCode loadElevatorCode
        unloadQuantity loadoutQuantity
        details {
          ticketSequenceNumber
          customerCode organizationCode elevatorCode gradeCode
          contractNumber ticketType
          ticketStatusCode ticketStatusDescription
          appliedGrossQuantity appliedNetQuantity appliedDockQuantity appliedShrinkQuantity
          finalSettledNetQuantity finalSettledDate ticketLastChangeDate
          gradeFactorMoisturePercent gradeFactorTestWeightPercent gradeFactorProteinPercent
          storageProgramCode cancelFlag priceSequence
        }
        """;

    /// <summary>
    /// Builds one document that fetches many tickets as separately-aliased root fields, collapsing N
    /// key lookups into a single request.
    /// </summary>
    /// <remarks>
    /// <para>This is what makes the ticket path viable. <c>tickets</c> accepts only a date range, so a
    /// producer's tickets have to be read individually by composite key; without aliasing that is N
    /// sequential round trips at roughly 350&#160;ms each. Aliasing was confirmed working against QA
    /// (two tickets in one request, 848&#160;ms).</para>
    ///
    /// <para>Keys are passed as GraphQL <b>variables</b>, never interpolated into the document. The
    /// key parts originate in ODS data, and splicing them into a query string would put a
    /// query-injection seam between two systems for no benefit — variables also avoid every escaping
    /// question about suffixes, which are frequently blank or a single space.</para>
    /// </remarks>
    /// <returns>The document plus the variable map to send alongside it. Alias <c>t{i}</c> corresponds
    /// to <paramref name="keys"/> at index <c>i</c>, so a null value identifies which key missed.</returns>
    public static (string Document, Dictionary<string, object?> Variables) BuildTicketBatch(IReadOnlyList<CtrmTicketKey> keys)
    {
        ArgumentOutOfRangeException.ThrowIfZero(keys.Count);

        var declarations = new StringBuilder();
        var body = new StringBuilder();
        var variables = new Dictionary<string, object?>(keys.Count * 5);

        for (var i = 0; i < keys.Count; i++)
        {
            var k = keys[i];

            if (i > 0) declarations.Append(", ");
            declarations.Append($"$p{i}: String!, $n{i}: String!, $s{i}: String!, $b{i}: Date!, $c{i}: String!");

            body.Append($"  t{i}: ticket(ticketPrefix: $p{i}, ticketNumber: $n{i}, ticketSuffix: $s{i}, ")
                .Append($"ticketBLDate: $b{i}, productCode: $c{i}) {{ ")
                .Append(TicketProjection.Replace("\r\n", " ").Replace('\n', ' '))
                .AppendLine(" }");

            variables[$"p{i}"] = k.Prefix;
            variables[$"n{i}"] = k.Number;
            variables[$"s{i}"] = k.Suffix;
            variables[$"b{i}"] = k.BlDate;
            variables[$"c{i}"] = k.ProductCode;
        }

        var document = $"query ({declarations}) {{{Environment.NewLine}{body}}}";
        return (document, variables);
    }
}
