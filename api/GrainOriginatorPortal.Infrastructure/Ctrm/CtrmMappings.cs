using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Projects CTRM GraphQL DTOs onto the entities the rest of the application already understands.
/// </summary>
/// <remarks>
/// The goal is that nothing downstream — controllers, services, the Angular client — can tell which
/// source a row came from. Where CTRM offers something ODS does not, this mapper deliberately
/// declines it, so that flipping <c>Ctrm:Source</c> surfaces genuine data differences rather than
/// differences in which fields we happened to populate.
/// </remarks>
public static class CtrmMappings
{
    /// <summary>Contract prefix for purchase contracts. Every contract query in the application
    /// filters to purchases; CTRM has no <c>contractPrefixType</c> argument, so it happens here.</summary>
    public const string PurchasePrefix = "P";

    /// <summary>
    /// Maps a page of CTRM contracts to <see cref="Contract"/>, keeping purchases only and computing
    /// status the same way the ODS path does.
    /// </summary>
    public static List<Contract> ToContracts(IEnumerable<CtrmContractDto> dtos, DateTime today)
    {
        var contracts = dtos
            .Where(d => !string.IsNullOrWhiteSpace(d.ContractId))
            .Where(d => string.Equals(d.ContractPrefixType?.Trim(), PurchasePrefix, StringComparison.OrdinalIgnoreCase))
            .Select(ToContract)
            .ToList();

        // Same two post-processing steps the ODS repository applies, from the same shared code, so a
        // producer's statuses cannot differ between sources for reasons unrelated to the data.
        ContractStatusCalculator.NormalizeOpenClosedDates(contracts);
        foreach (var contract in contracts)
            contract.Status = ContractStatusCalculator.Calculate(contract, today);

        return contracts;
    }

    private static Contract ToContract(CtrmContractDto d) => new()
    {
        Id = CtrmSyntheticId.From(d.ContractId),

        // No CTRM equivalent — CustomerId is an ODS surrogate bigint and FarmId is not sourced from
        // CTRM at all. The join downstream runs on CtrmCustomerId, which is the Scoular customer
        // code and is byte-identical to ODS CustomerCode / Customer.ScoularId.
        CustomerId = null,
        FarmId = string.Empty,
        CtrmCustomerId = Clean(d.CustomerId),

        SourceContractId = Clean(d.ContractId),
        ContractNumber = Clean(d.ContractNumber) ?? string.Empty,
        ContractPrefixType = Clean(d.ContractPrefixType),

        // Not projected (2026-08-28 usage trace): the client Contract model has no customerName and no
        // server logic reads it - producer names come from the customer master, keyed on CtrmCustomerId.
        // ODS populates it, so this is a deliberate field-population difference, not a data one.
        CustomerName = null,

        CommodityCode = Clean(d.CommodityCode),
        CommodityDescription = Clean(d.CommodityDescription),
        CommodityGroup = Clean(d.CommodityGroup),
        TradeUnit = Clean(d.TradeUnit),

        Quantity = d.Quantity,
        PricedQuantity = d.PricedQuantity,
        Unit = Clean(d.QuantityUom),
        TotalValue = d.TotalValue,

        ContractDate = NullIfSentinel(d.ContractDate),
        DeliveryStart = NullIfSentinel(d.StartShipDate),
        DeliveryEnd = NullIfSentinel(d.FinalShipDate),
        ClosedDate = NullIfSentinel(d.ClosedDate),

        CropYear = d.CropYear,
        OpenBalanceQuantity = d.OpenBalanceQuantity,
        SettledQuantity = d.SettledQuantity,

        PriceTypeCode = Clean(d.PriceTypeCode),
        SpecialType = Clean(d.SpecialType),
        CustomerConfirmStatus = Clean(d.CustomerConfirmStatus),
        MarketZone = Clean(d.MarketZone),
        BasisLocation = Clean(d.BasisLocation),

        // Arrive on the header here. The ODS path needs a second query against base.Contract to fill
        // these in (EnrichWithHedgeMarketMonthAsync), which has no counterpart on this path.
        HedgeMarketMonthDescription = Clean(d.HedgeMarketMonthDescription),
        PriceMarketMonthDescription = Clean(d.PriceMarketMonthDescription),

        // Mirrors the ODS path, which hardcodes Signed because the view has no such column.
        Signed = true,

        // vw_CurrentContracts only ever yields IsActive = 1 / IsDeleted = 0 rows — the query filters
        // on it — so the CTRM equivalent of "we fetched it, therefore it is current" is these two
        // constants. CTRM tracks currency via lastActivity* rather than SCD columns, so the
        // effective-date pair has no equivalent and stays null.
        IsActive = true,
        IsDeleted = false,
        EffectiveStartDate = null,
        EffectiveEndDate = null
    };

    /// <summary>
    /// Flattens the pricing lines off a page of contracts. <see cref="ContractPricingLine.ContractId"/>
    /// carries the parent's <c>contractId</c> because that is the key the client groups on.
    /// </summary>
    /// <remarks>
    /// Purchase-only filtering applies here too — otherwise a sale contract's price lines would leak
    /// into a producer's pricing view even though its header was filtered out.
    /// </remarks>
    public static List<ContractPricingLine> ToPricingLines(IEnumerable<CtrmContractDto> dtos) =>
        dtos
            .Where(d => !string.IsNullOrWhiteSpace(d.ContractId))
            .Where(d => string.Equals(d.ContractPrefixType?.Trim(), PurchasePrefix, StringComparison.OrdinalIgnoreCase))
            .SelectMany(d => d.Prices.Select(p => ToPricingLine(d, p)))
            // Ordered, not left to the server. ODS sorts these by ContractId then PriceSequence, and the
            // contracts table reads safeLines[0] POSITIONALLY to pick the price to badge - so the order is
            // load-bearing, not cosmetic. Live CTRM data happens to arrive ordered by priceSequence; this
            // makes it a guarantee rather than an observation. Ordinal to match SQL's byte ordering.
            .OrderBy(l => l.ContractId, StringComparer.Ordinal)
            .ThenBy(l => l.PriceSequence ?? int.MaxValue)
            .ToList();

    private static ContractPricingLine ToPricingLine(CtrmContractDto parent, CtrmContractPriceDto p) => new()
    {
        ContractId = Clean(parent.ContractId) ?? string.Empty,
        ContractNumber = Clean(parent.ContractNumber),

        // 0 is a real sequence number on this data, not a missing value.
        PriceSequence = p.PriceSequence,
        PriceQuantity = p.PriceQuantity,

        FlatPrice = p.FlatPrice,
        BasisPrice = p.BasisPrice,
        HedgePrice = p.HedgePrice,

        // The one clear win over ODS: vw_ContractPricing does not expose this, so the ODS path runs a
        // second query against base.ContractPrice keyed on (SourceContractId, PriceSequence) to get
        // it. CTRM returns it on the line.
        FreightAdjustment = p.FreightAdjustment,

        PriceDate = NullIfSentinel(p.PriceDate),
        CustomerConfirmStatus = Clean(p.CustomerConfirmStatus)

        // Everything else on the entity stays null on purpose. ConfirmationStatus and CreatedDate have no
        // CTRM equivalent. CustomerName, PriceUom, PriceCurrency, TraderInitials, Trader, the
        // open/applied/settled quantity and weight trios, BrokerConfirmStatus and ModifiedDate were
        // projected and mapped until 2026-08-28, when a usage trace showed nothing in the client or the
        // server reads any of them - and prices roughly double a contract page, so dead fields here cost
        // real time on the one read that pays for the collection.
    };

    // -------------------------------------------------------------------------
    // Tickets
    // -------------------------------------------------------------------------

    /// <summary>Cancelled marker on a ticket detail row.</summary>
    public const string CancelledFlag = "Y";

    /// <summary>
    /// Projects every detail row applied to one of these contracts, whoever it is booked under.
    /// </summary>
    /// <remarks>
    /// <para>Scoped on the contract ALONE, with no customer-code condition. That is deliberate and it is
    /// the rule the ODS ticket query uses: a row applied to this producer's contract is this producer's
    /// ticket, whichever customer code the detail row happens to carry. Adding a customer-code condition
    /// here would silently drop a split load - a ticket applied to the contract but booked under a second
    /// producer - and the contract's applied bushels would then disagree with the ticket list above it.</para>
    ///
    /// <para>Pass only OPEN purchase contract ids. Scoping to open purchase contracts rather than to the
    /// customer code is what keeps sale-side and closed-contract activity off the screen: measured on one
    /// producer, customer-code alone gave 1,525 applied tickets where the contract scope gives 280.</para>
    /// </remarks>
    public static List<Ticket> ToAppliedForContracts(CtrmTicketDto header, ISet<string> contractIds)
        => ToTickets(header, d =>
        {
            var contractNumber = d.ContractNumber?.Trim();
            return !string.IsNullOrEmpty(contractNumber) && contractIds.Contains(contractNumber);
        });

    /// <summary>
    /// Projects this producer's rows that are not applied to any purchase contract.
    /// </summary>
    /// <remarks>
    /// The counterpart to <see cref="ToAppliedForContracts"/>, and the two together reproduce the ODS
    /// query's two branches. This side DOES scope on customer code, because a U/L/C row has no real
    /// contract to match against - the customer code is the only thing tying it to a producer.
    /// </remarks>
    /// <summary>
    /// The unapplied rows belonging to ANY of these producers, in one pass over the header.
    /// </summary>
    /// <remarks>
    /// The batch counterpart to <see cref="ToUnappliedForProducer"/>. Calling the single-producer version
    /// once per code instead rescans every detail row once per producer - with several hundred producers
    /// in scope that is hundreds of passes over the same header to find the one code that matches.
    /// </remarks>
    public static List<Ticket> ToUnappliedForProducers(CtrmTicketDto header, ISet<string> scoularIds)
        => ToTickets(header, d =>
        {
            var customerCode = d.CustomerCode?.Trim();
            if (string.IsNullOrEmpty(customerCode) || !scoularIds.Contains(customerCode)) return false;

            var contractNumber = d.ContractNumber?.Trim();
            return !string.IsNullOrEmpty(contractNumber) && IsUnappliedPrefix(contractNumber[0]);
        });
    public static List<Ticket> ToUnappliedForProducer(CtrmTicketDto header, string scoularId)
        => ToTickets(header, d =>
        {
            if (!Matches(d.CustomerCode, scoularId)) return false;

            var contractNumber = d.ContractNumber?.Trim();

            // U (unload), L (loadout) and C (customer storage) all mean no purchase contract is assigned.
            return !string.IsNullOrEmpty(contractNumber) && IsUnappliedPrefix(contractNumber[0]);
        });

    /// <summary>U, L and C mark a ticket as not yet applied to a purchase contract.</summary>
    private static bool IsUnappliedPrefix(char c)
        => c is 'U' or 'u' or 'L' or 'l' or 'C' or 'c';
    public static List<Ticket> ToTickets(CtrmTicketDto header, string scoularId)
        => ToTickets(header, d => Matches(d.CustomerCode, scoularId));

    /// <summary>
    /// Projects the detail rows belonging to a specific contract, whichever producer they name.
    /// </summary>
    /// <remarks>
    /// Backs the contracts table's per-row expansion. Deliberately keyed on the contract rather than the
    /// producer: the contract's applied bushels are the sum of every detail row against it, and a
    /// producer filter here would understate the total whenever a load was split.
    /// </remarks>
    public static List<Ticket> ToTicketsForContract(CtrmTicketDto header, string sourceContractId)
        => ToTickets(header, d => Matches(d.ContractNumber, sourceContractId));

    /// <summary>
    /// Projects a CTRM ticket header into one <see cref="Ticket"/> per detail row the caller keeps.
    /// </summary>
    /// <remarks>
    /// <para><b>One ticket in, potentially several out.</b> A physical ticket can be split across many
    /// producers - one observed case had 15 detail rows - and the header quantities describe the whole
    /// load, not any one producer's share. Emitting the header as a single row would attribute the
    /// entire load to whichever producer was asked about, so the detail row is the unit of projection
    /// and the header only contributes load-level context.</para>
    ///
    /// <para>Three filters apply for every caller, so no scope can accidentally widen the population:
    /// cancelled rows, ticket types the app never shows, and consolidated rows whose bushels have already
    /// been counted under the ticket that superseded them. The server is asked to exclude the first and
    /// third where the query supports it; these stay because not every document can pass those arguments.</para>
    /// </remarks>
    private static List<Ticket> ToTickets(CtrmTicketDto header, Func<CtrmTicketDetailDto, bool> keep)
    {
        var blDate = NullIfSentinel(header.TicketBLDate);

        return header.Details
            .Where(keep)
            .Where(d => !string.Equals(d.CancelFlag?.Trim(), CancelledFlag, StringComparison.OrdinalIgnoreCase))
            .Where(IsOdsEligible)
            .Select(d => new Ticket
            {
                Id = CtrmSyntheticId.From(
                    header.TicketPrefix, header.TicketNumber, header.TicketSuffix,
                    blDate?.ToString("yyyy-MM-dd"), header.ProductCode,
                    d.TicketSequenceNumber?.ToString()),

                CustomerCode = Clean(d.CustomerCode),

                ProductCode = Clean(header.ProductCode),
                TicketPrefix = Clean(header.TicketPrefix),
                TicketNumber = Clean(header.TicketNumber) ?? string.Empty,
                TicketSuffix = Clean(header.TicketSuffix),

                // Keeps the prefix character, which IsApplied reads to classify U/L/C as unapplied.
                CtrmContractNumber = Clean(d.ContractNumber),

                OrganizationCode = Clean(d.OrganizationCode),
                ElevatorCode = Clean(d.ElevatorCode),

                // ODS stores TicketBlDate as a string; formatted identically so any downstream string
                // comparison or lexicographic date sort behaves the same on both paths.
                Date = blDate?.ToString("yyyy-MM-dd"),
                FinalSettledDate = NullIfSentinel(d.FinalSettledDate),

                // Load-level, from the header — deliberately not divided among producers.
                UnloadQuantity = header.UnloadQuantity,

                // Named for the ODS column it stands in for: AppliedDockQuantity holds ODS
                // AppliedNetQuantity, a bigint in POUNDS. Passing pounds through unchanged preserves
                // parity exactly and leaves the downstream lb-to-bushel conversion (vw_GNP024, still
                // an ODS lookup) untouched.
                AppliedDockQuantity = d.AppliedNetQuantity is null ? null : (long)d.AppliedNetQuantity.Value,

                // Quality, inline here rather than joined from vw_TicketQuality.
                Moisture = d.GradeFactorMoisturePercent,
                TestWeight = d.GradeFactorTestWeightPercent,
                ProteinPercent = d.GradeFactorProteinPercent,
                GradeCode = Clean(d.GradeCode),

                TicketType = Clean(d.TicketType),
                TicketStatusDescription = Clean(d.TicketStatusDescription),
                IsActive = true,

                // Set for APPLIED rows only, to the same synthetic id CtrmMappings.ToContract gives the
                // contract itself - both derive from the trimmed contract number, so they match by
                // construction. This restores the client's fallback contract-to-ticket join
                // (contracts-table.component.ts:689-692), which was dead on the CTRM path because nothing
                // populated it. Not a parity break: the ODS TicketRepository already notes this FK "isn't
                // reliably populated", and OdsIgnoredFields_StayUnset_ForParity does not assert it null.
                // Unapplied rows have no contract, so they keep null.
                ContractId = AppliedContractSyntheticId(d.ContractNumber)

                // Left unset for parity: AppliedQuantity, GrossWeight, TareWeight and NetWeight are all
                // Ignore()d on the ODS entity, so populating them from CTRM would show up as a
                // field-population difference rather than a data difference. CustomerId, FarmId and the
                // SourceTicket*Id pair are ODS surrogates with no CTRM equivalent. ElevatorCity/State stay
                // null here and are filled by the ODS elevator lookup, exactly as on the ODS path.
                //
                // Left unset because NOTHING reads them (2026-08-28 usage trace): ShipmentTicketNumber,
                // UnloadOrganizationCode and LoadoutQuantity are populated by ODS but rendered nowhere and
                // read by no server logic, so they are no longer projected or mapped. If a screen ever
                // needs one, re-add it to TicketProjection, this mapping, and the trace.
            })
            .ToList();
    }

    // -------------------------------------------------------------------------

    /// <summary>
    /// The contract's synthetic id for an APPLIED ticket row, or null when the row is not applied.
    /// </summary>
    /// <remarks>
    /// Only purchase-prefixed numbers count. A U, L or C prefix is an unapplied/storage row - those carry
    /// a "contract number" that is not a purchase contract, and hashing it would invent a link to a
    /// contract that does not exist.
    /// </remarks>
    private static long? AppliedContractSyntheticId(string? contractNumber)
    {
        var number = Clean(contractNumber);
        if (string.IsNullOrEmpty(number)) return null;

        return number.StartsWith(PurchasePrefix, StringComparison.OrdinalIgnoreCase)
            ? CtrmSyntheticId.From(number)
            : null;
    }

    /// <summary>
    /// Rewrites Db2's minimum date to null.
    /// </summary>
    /// <remarks>
    /// CTRM returns <c>0001-01-01</c> rather than null for an unset date, and it turns up on
    /// <c>closedDate</c>, <c>latestShipmentDate</c>, <c>finalSettledDate</c>, <c>confirmDate</c> and
    /// <c>priceDate</c>. Left alone it would deserialize to a real-looking
    /// <see cref="DateTime"/> and, for <c>closedDate</c> in particular, make every open contract
    /// read as closed.
    /// </remarks>
    public static DateTime? NullIfSentinel(DateTime? value) =>
        value is null || value.Value.Date <= OdsConstants.OpenClosedDateSentinel ? null : value;

    /// <summary>Ticket types the application shows: Unload and Purchase.</summary>
    private static readonly string[] VisibleTicketTypes = ["U", "P"];

    /// <summary>Status the ODS query excludes — a consolidated ticket is superseded by the one that
    /// consolidated it, so showing both would double-count the bushels.</summary>
    private const string ConsolidatedStatus = "Consolidated";

    /// <summary>
    /// The two row-level filters the ODS ticket query applies, so both sources scope the same population.
    /// </summary>
    /// <remarks>
    /// These live on the DETAIL row in CTRM but on the ticket row in the ODS view, which is why they are
    /// applied here rather than in the query: there is no server-side argument for either. Without them the
    /// CTRM path returned ticket types the app never shows and double-counted consolidated bushels, so a
    /// source comparison would differ for reasons that have nothing to do with data freshness.
    /// </remarks>
    private static bool IsOdsEligible(CtrmTicketDetailDto d)
    {
        var type = d.TicketType?.Trim();
        if (type is null || !VisibleTicketTypes.Contains(type, StringComparer.OrdinalIgnoreCase))
            return false;

        // ODS treats a NULL status as eligible; only an explicit "Consolidated" is excluded.
        var status = d.TicketStatusDescription?.Trim();
        return status is null || !status.Equals(ConsolidatedStatus, StringComparison.OrdinalIgnoreCase);
    }
    /// <summary>Case-insensitive, whitespace-tolerant comparison of a CTRM code against one of ours.</summary>
    private static bool Matches(string? value, string code) =>
        string.Equals(value?.Trim(), code?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Trims, and collapses whitespace-only values to null.</summary>
    /// <remarks>
    /// CTRM trims most strings, but not all — <c>contractSuffix</c> comes back as a single space —
    /// and the ODS entity configuration trims these same columns on read because the Db2 source is
    /// CHAR-padded. Normalizing here keeps string comparisons against ODS-sourced values working.
    /// </remarks>
    private static string? Clean(string? value)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
