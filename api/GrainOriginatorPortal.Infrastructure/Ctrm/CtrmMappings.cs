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
        CustomerName = Clean(d.CustomerName),

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
            .ToList();

    private static ContractPricingLine ToPricingLine(CtrmContractDto parent, CtrmContractPriceDto p) => new()
    {
        ContractId = Clean(parent.ContractId) ?? string.Empty,
        ContractNumber = Clean(parent.ContractNumber),
        CustomerName = Clean(parent.CustomerName),

        // 0 is a real sequence number on this data, not a missing value.
        PriceSequence = p.PriceSequence,
        PriceQuantity = p.PriceQuantity,
        PriceUom = Clean(p.PriceUom),

        FlatPrice = p.FlatPrice,
        BasisPrice = p.BasisPrice,
        HedgePrice = p.HedgePrice,

        // The one clear win over ODS: vw_ContractPricing does not expose this, so the ODS path runs a
        // second query against base.ContractPrice keyed on (SourceContractId, PriceSequence) to get
        // it. CTRM returns it on the line.
        FreightAdjustment = p.FreightAdjustment,

        PriceDate = NullIfSentinel(p.PriceDate),
        PriceCurrency = Clean(p.PriceCurrency),

        TraderInitials = Clean(p.TraderInitials),
        Trader = Clean(p.Trader),

        PriceOpenQuantity = p.PriceOpenQuantity,
        PriceAppliedQuantity = p.PriceAppliedQuantity,
        PriceSettledQuantity = p.PriceSettledQuantity,
        PriceOpenWeight = p.PriceOpenWeight,
        PriceAppliedWeight = p.PriceAppliedWeight,
        PriceSettledWeight = p.PriceSettledWeight,

        CustomerConfirmStatus = Clean(p.CustomerConfirmStatus),
        BrokerConfirmStatus = Clean(p.BrokerConfirmStatus),

        // No CTRM equivalent for either. ConfirmationStatus is an ODS-only rollup, and a price line
        // carries a single lastActivityTimestamp rather than a created/modified pair.
        ConfirmationStatus = null,
        CreatedDate = null,
        ModifiedDate = NullIfSentinel(p.LastActivityTimestamp)
    };

    // -------------------------------------------------------------------------
    // Tickets
    // -------------------------------------------------------------------------

    /// <summary>Cancelled marker on a ticket detail row.</summary>
    public const string CancelledFlag = "Y";

    /// <summary>
    /// Projects a CTRM ticket into one <see cref="Ticket"/> per detail row belonging to
    /// <paramref name="scoularId"/>.
    /// </summary>
    /// <remarks>
    /// <para><b>One ticket in, potentially several out.</b> A physical ticket can be split across many
    /// producers — one observed case had 15 detail rows — and the header quantities describe the whole
    /// load, not any one producer's share. Emitting the header as a single row would attribute the
    /// entire load to whichever producer was asked about, so the detail row is the unit of projection
    /// and the header only contributes load-level context.</para>
    ///
    /// <para>Cancelled rows are dropped. The ODS view excludes them upstream; whether CTRM does is
    /// still unconfirmed, so this filters defensively rather than assuming parity.</para>
    /// </remarks>
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

    private static List<Ticket> ToTickets(CtrmTicketDto header, Func<CtrmTicketDetailDto, bool> keep)
    {
        var blDate = NullIfSentinel(header.TicketBLDate);

        return header.Details
            .Where(keep)
            .Where(d => !string.Equals(d.CancelFlag?.Trim(), CancelledFlag, StringComparison.OrdinalIgnoreCase))
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
                ShipmentTicketNumber = Clean(header.ShipmentTicketNumber),

                // Keeps the prefix character, which IsApplied reads to classify U/L/C as unapplied.
                CtrmContractNumber = Clean(d.ContractNumber),

                OrganizationCode = Clean(d.OrganizationCode),
                ElevatorCode = Clean(d.ElevatorCode),
                UnloadOrganizationCode = Clean(header.UnloadOrganizationCode),

                // ODS stores TicketBlDate as a string; formatted identically so any downstream string
                // comparison or lexicographic date sort behaves the same on both paths.
                Date = blDate?.ToString("yyyy-MM-dd"),
                FinalSettledDate = NullIfSentinel(d.FinalSettledDate),

                // Load-level, from the header — deliberately not divided among producers.
                UnloadQuantity = header.UnloadQuantity,
                LoadoutQuantity = header.LoadoutQuantity,

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
                IsActive = true

                // Left unset for parity: AppliedQuantity, GrossWeight, TareWeight and NetWeight are all
                // Ignore()d on the ODS entity, so populating them from CTRM would show up as a
                // field-population difference rather than a data difference. ContractId, CustomerId,
                // FarmId and the SourceTicket*Id pair are ODS surrogates with no CTRM equivalent.
                // ElevatorCity/State stay null here and are filled by the ODS elevator lookup, exactly
                // as on the ODS path.
            })
            .ToList();
    }

    // -------------------------------------------------------------------------

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
