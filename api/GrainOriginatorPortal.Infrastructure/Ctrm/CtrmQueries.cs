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
    /// <para>The date window is the only filter that is fast here. <c>customerIds</c> exists and would let
    /// the pool be scoped by producer instead - matching the per-producer read's full history - but it is
    /// not indexed the way the singular <c>customerId</c> is: ~20-25s per request regardless of list size,
    /// and the whole population is dozens of pages. Two attempts died at the gateway (234s priced, 147s
    /// lean). Contract date IS indexed, so the window stays until that changes.</para>
    ///
    /// <para><b>No pricing lines.</b> They roughly double both the time and the payload for a page -
    /// measured 11.6s / 604KB against 6.1s / 352KB - and this walk is eighteen pages at four-way
    /// concurrency. That pressure was making the server return an intermittent HTTP 500 mid-walk, which
    /// fails the whole snapshot; the pages are fine one at a time. Nothing reads the collection from here
    /// either: <c>CtrmMappings.ToContract</c> takes only the scalar price fields, and the one caller that
    /// wanted the lines is delegated to ODS.</para>
    ///
    /// <para>No <c>contractPrefixType</c> argument on this query even though one exists, because the
    /// snapshot also answers reads that want the unfiltered window; purchase-only filtering happens in
    /// the mapping.</para>
    /// </remarks>
    public const string ContractsPage = """
        query ($from: Date!, $to: Date!, $skip: Int!, $take: Int!) {
          contracts(skip: $skip, take: $take, contractDateFrom: $from, contractDateTo: $to) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + ContractCoreProjection + """
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

    /// <summary>Projection shared by every ticket document, so no two can drift into different columns.</summary>
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

    // -------------------------------------------------------------------------
    // Per-producer live reads (AB#33538 / AB#33814 / AB#33816)
    // -------------------------------------------------------------------------

    /// <summary>
    /// Every scalar field a <see cref="Data.Entities.Contract"/> reads, with no child collections.
    /// </summary>
    /// <remarks>
    /// Split out from <see cref="ContractProjection"/> because the pricing lines are the expensive half.
    /// This API resolves child collections per-field via DataLoader, so asking for <c>prices</c> costs real
    /// time: measured on a 500-row page, 4.0s without it against 8.1s with it. Contract-list reads do not
    /// need it - <c>CtrmMappings.ToContract</c> maps only the scalar price fields (<c>pricedQuantity</c>,
    /// <c>priceTypeCode</c>, <c>priceMarketMonthDescription</c>) and never touches the collection - so a
    /// list query that projected it would pay double for rows it discards.
    /// </remarks>
    private const string ContractCoreProjection = """
        contractId contractPrefixType contractNumber
        customerId customerName tradeUnit
        commodityCode commodityDescription commodityGroup
        contractDate startShipDate finalShipDate closedDate cropYear
        quantity quantityUom totalValue
        pricedQuantity openBalanceQuantity settledQuantity
        priceTypeCode specialType customerConfirmStatus
        marketZone basisLocation
        hedgeMarketMonthDescription priceMarketMonthDescription
        """;

    /// <summary>Field list shared by every contract read that needs pricing lines, so those reads cannot
    /// drift into projecting different columns.</summary>
    private const string ContractProjection = ContractCoreProjection + "\n" + """
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
        """;
    /// <summary>
    /// One producer's purchase contracts, filtered server-side, with NO date range at all.
    /// Variables: <c>$customerId</c> (String), <c>$prefix</c> (String), <c>$skip</c>, <c>$take</c> (Int).
    /// </summary>
    /// <remarks>
    /// <para>This is the query the whole snapshot design existed to work around. Omitting the dates is
    /// legal ONLY because a single <c>customerId</c> is supplied — the server treats that as a selective
    /// indexed predicate and waives the otherwise-mandatory range. It therefore returns the producer's
    /// FULL history, not a window: verified 2023-2026 for real producers.</para>
    ///
    /// <para><c>contractPrefixType</c> filters to purchases server-side, so sale contracts never cross
    /// the wire — every contract screen in this app is purchase-only.</para>
    ///
    /// <para>Do NOT be tempted to swap <c>customerId</c> for <c>customerIds</c> here. The plural form
    /// still requires a date range, and supplying a wide one to compensate makes the server exceed its
    /// own 30-second timeout (<c>HC0045</c>) — measured, not theorised.</para>
    /// </remarks>
    public const string ContractsByCustomer = """
        query ($customerId: String, $prefix: String, $skip: Int, $take: Int) {
          contracts(skip: $skip, take: $take, customerId: $customerId, contractPrefixType: $prefix) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + ContractProjection + """
            }
          }
        }
        """;

    /// <summary>
    /// One producer's tickets over a bill-of-lading window, filtered server-side.
    /// Variables: <c>$customerId</c> (String), <c>$from</c>/<c>$to</c> (Date), <c>$skip</c>, <c>$take</c> (Int).
    /// </summary>
    /// <remarks>
    /// <para>Unlike contracts, the date range stays MANDATORY here even with a customer filter, and it is
    /// still capped at <see cref="MaxTicketRangeDays"/>. The reason is structural: the ticket header carries
    /// no customer at all - the customer lives on the detail rows - so the filter is an EXISTS semi-join and
    /// the date range is what keeps the header scan bounded. Callers therefore slice a longer lookback into
    /// consecutive windows rather than asking for one wide one. Waiving it needs a redesign on the API side;
    /// it is tracked there but not delivered.</para>
    ///
    /// <para><c>excludeCancelled</c> and <c>excludeConsolidated</c> are opt-in server-side versions of two
    /// filters <see cref="CtrmMappings"/> also applies row by row. The duplication is deliberate: asking the
    /// server keeps those rows off the wire (measured 14 of 228 detail rows for one producer), while the
    /// client-side check is what guarantees ODS parity regardless of which document fed it, since the
    /// single-ticket and batch lookups cannot pass these arguments at all.</para>
    ///
    /// <para>Deliberately no <c>ticketType</c> argument, though the API now accepts one: it takes a single
    /// value and the app shows two types (U and P), so it cannot express our filter. Measured against live
    /// data it would also drop nothing - every detail row came back type U.</para>
    /// </remarks>
    public const string TicketsByCustomer = """
        query ($customerId: String, $from: Date, $to: Date, $skip: Int, $take: Int) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to, customerId: $customerId,
                  excludeCancelled: true, excludeConsolidated: true) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + TicketProjection + """
            }
          }
        }
        """;

    /// <summary>
    /// Every ticket applied to a set of contract numbers, over a bill-of-lading window.
    /// Variables: <c>$contractNumbers</c> ([String!]), <c>$from</c>/<c>$to</c> (Date), <c>$skip</c>, <c>$take</c> (Int).
    /// </summary>
    /// <remarks>
    /// <para>Scopes on the contract rather than the producer, so a split load - a ticket applied to this
    /// contract but booked under a different customer code - is included. Measured against QA that changed
    /// nothing for the producers checked (150 rows either way, all under the same code), so this is not a
    /// fix for a known defect; it removes the assumption that there is nothing to fix.</para>
    ///
    /// <para>The date range is still mandatory and still capped, for the same reason as the customer filter:
    /// the contract number lives on the detail row too, so this is the same semi-join. One contract over a
    /// one-year window measures ~1.7s.</para>
    /// </remarks>
    public const string TicketsByContractNumbers = """
        query ($contractNumbers: [String!], $from: Date, $to: Date, $skip: Int, $take: Int) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to,
                  contractNumbers: $contractNumbers,
                  excludeCancelled: true, excludeConsolidated: true) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + TicketProjection + """
            }
          }
        }
        """;


    /// <summary>
    /// Purchase contracts for a batch of producers in one crop year, with NO date range.
    /// Variables: <c>$customerIds</c> ([String!]), <c>$prefix</c> (String), <c>$cropYear</c> (Int),
    /// <c>$skip</c>, <c>$take</c> (Int).
    /// </summary>
    /// <remarks>
    /// <para>Backs the crop-year contract list the Build-a-List screen queries, which had to be delegated
    /// to ODS while <c>cropYear</c> was readable but not filterable. Every predicate the ODS query applies
    /// is now expressible server-side: producer codes, purchase-only, and the crop year.</para>
    ///
    /// <para><c>customerIds</c> is what makes the date range optional - the plural form waives it exactly
    /// as the singular does, so this returns a producer's whole crop year rather than a window. It is
    /// capped at 500 entries, so callers chunk. Note the pairing matters: <c>cropYear</c> on its own does
    /// NOT waive the range, and narrowing a date scan by crop year costs ~20s for 27 rows.</para>
    ///
    /// <para>Deliberately <see cref="ContractCoreProjection"/> and not the full one. Nothing in a contract
    /// list reads the pricing lines, and projecting them doubles the per-page cost.</para>
    /// </remarks>
    public const string ContractsByCustomersAndCropYear = """
        query ($customerIds: [String!], $prefix: String, $cropYear: Int, $skip: Int, $take: Int) {
          contracts(skip: $skip, take: $take, customerIds: $customerIds,
                    contractPrefixType: $prefix, cropYear: $cropYear) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + ContractCoreProjection + """
            }
          }
        }
        """;

    /// <summary>
    /// Tickets for a batch of producers over one bill-of-lading window.
    /// Variables: <c>$customerIds</c> ([String!]), <c>$from</c>/<c>$to</c> (Date), <c>$skip</c>, <c>$take</c> (Int).
    /// </summary>
    /// <remarks>
    /// <para>Backs the recent-unapplied read that Spot Loads is built on. Viable where a trade-unit-wide
    /// ticket read is not, and the reason is worth recording: the cost of a ticket query is the header
    /// SCAN, not the rows returned. Measured for 88 producers - one day 0 rows in 11.6s, one week 19 rows
    /// in 6.5s, thirty days 76 rows in 6.1s. A narrow window is therefore cheap in rows while costing the
    /// same few seconds, so a 30-day question is one request per chunk. The same query over three years is
    /// 26,529 rows for those producers and about a thousand pages at full scale, which is why the
    /// trade-unit-wide ticket read stays on ODS.</para>
    ///
    /// <para><c>customerIds</c> does NOT waive the date range the way it does for contracts - the ticket
    /// header carries no customer, so the range is what bounds the scan. Callers must supply one, and it
    /// cannot exceed <see cref="MaxTicketRangeDays"/>.</para>
    /// </remarks>
    public const string TicketsByCustomers = """
        query ($customerIds: [String!], $from: Date, $to: Date, $skip: Int, $take: Int) {
          tickets(skip: $skip, take: $take, blDateFrom: $from, blDateTo: $to,
                  customerIds: $customerIds,
                  excludeCancelled: true, excludeConsolidated: true) {
            totalCount
            pageInfo { skip take hasNextPage hasPreviousPage }
            items {
        """ + TicketProjection + """
            }
          }
        }
        """;
}
