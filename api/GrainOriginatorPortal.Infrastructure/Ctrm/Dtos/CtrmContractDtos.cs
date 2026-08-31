namespace GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

/// <summary>Standard page wrapper the CTRM API puts around every collection root field.</summary>
/// <remarks>
/// <see cref="TotalCount"/> is the count for the whole date window, not the page — it is the only
/// way to tell whether a snapshot got truncated, so the snapshot loader reports it.
/// </remarks>
public sealed class CtrmPage<T>
{
    public int TotalCount { get; set; }
    public CtrmPageInfo? PageInfo { get; set; }
    public List<T> Items { get; set; } = [];
}

public sealed class CtrmPageInfo
{
    public int Skip { get; set; }
    public int Take { get; set; }
    public bool HasNextPage { get; set; }
    public bool HasPreviousPage { get; set; }
}

/// <summary>Envelope for the <c>contracts</c> root field.</summary>
public sealed class CtrmContractsResponse
{
    public CtrmPage<CtrmContractDto>? Contracts { get; set; }
}

/// <summary>
/// A CTRM contract header. Every property here was verified against live QA data during the
/// AB#32062 pass — this is deliberately not the API's full projection, only the fields the portal
/// actually reads.
/// </summary>
/// <remarks>
/// Dates arrive as the GraphQL <c>Date</c> scalar, i.e. <c>"2026-07-30"</c>, which
/// System.Text.Json binds to <see cref="DateTime"/> directly. Unset dates come back as the Db2
/// minimum <c>0001-01-01</c> rather than null, so they land as <see cref="DateTime.MinValue"/> and
/// are normalized during mapping — never treat a non-null date here as meaningful on its own.
/// </remarks>
public sealed class CtrmContractDto
{
    // Identity. contractId is the prefixed natural key (e.g. "PWW227420"); contractNumber is the
    // same value without the prefix character. Note contractNumber alone is NOT unique — a paired
    // sale/purchase shares it (SEW659816 / PEW659816), so contractId is the real key.
    public string? ContractId { get; set; }
    public string? ContractPrefixType { get; set; }
    public string? ContractNumber { get; set; }

    // The Scoular customer code. Byte-identical to ODS CustomerCode / Contract.CtrmCustomerId /
    // Customer.ScoularId — one namespace, verified on TATOBIN. This is the whole join.
    public string? CustomerId { get; set; }
    public string? TradeUnit { get; set; }

    public string? CommodityCode { get; set; }
    public string? CommodityDescription { get; set; }
    public string? CommodityGroup { get; set; }

    public DateTime? ContractDate { get; set; }
    public DateTime? StartShipDate { get; set; }
    public DateTime? FinalShipDate { get; set; }
    public DateTime? ClosedDate { get; set; }
    public int? CropYear { get; set; }

    public decimal? Quantity { get; set; }
    public string? QuantityUom { get; set; }
    public decimal? TotalValue { get; set; }

    // Contract.Weight and Contract.Price are deliberately absent. CTRM exposes a `weight` field,
    // but OriginationDbContext calls Ignore() on both properties, so the ODS path always leaves
    // them null. Populating them here would make the ODS-vs-CTRM comparison show a field-population
    // difference rather than a data difference, which is the opposite of what this spike is for.

    public decimal? PricedQuantity { get; set; }
    public decimal? OpenBalanceQuantity { get; set; }
    public decimal? SettledQuantity { get; set; }

    /// <summary>Raw P/U/D code, not the description — the pricing badge switches on this.</summary>
    public string? PriceTypeCode { get; set; }

    public string? SpecialType { get; set; }
    public string? CustomerConfirmStatus { get; set; }
    public string? MarketZone { get; set; }
    public string? BasisLocation { get; set; }

    /// <summary>Returned directly by CTRM. The ODS path has to enrich these from base.Contract in a
    /// second query; here they arrive on the header, so no enrichment step is needed.</summary>
    public string? HedgeMarketMonthDescription { get; set; }
    public string? PriceMarketMonthDescription { get; set; }

    public List<CtrmContractPriceDto> Prices { get; set; } = [];
}

/// <summary>
/// A CTRM contract pricing line, equivalent to a base.vw_ContractPricing row.
/// </summary>
/// <remarks>
/// <see cref="FreightAdjustment"/> is the notable one: the ODS path needs a second query against
/// base.ContractPrice matched on (SourceContractId, PriceSequence) to get it, because
/// vw_ContractPricing does not expose it. CTRM returns it on the line.
/// </remarks>
public sealed class CtrmContractPriceDto
{
    /// <summary>Observed as 0 on live data — 0 is a valid sequence here, not a missing value.</summary>
    public int? PriceSequence { get; set; }

    public decimal? PriceQuantity { get; set; }

    public decimal? FlatPrice { get; set; }
    public decimal? BasisPrice { get; set; }
    public decimal? HedgePrice { get; set; }
    public decimal? FreightAdjustment { get; set; }

    public DateTime? PriceDate { get; set; }

    public string? CustomerConfirmStatus { get; set; }

    /// <summary>No longer projected or mapped (nothing read it), but kept as the deserialization
    /// vehicle for <c>CtrmDateTimeConverterTests</c>: one of these values arriving space-separated
    /// ("2026-08-01 00:32:53") once failed an entire contracts page, and the regression test pins the
    /// converter on the exact field where it happened.</summary>
    public DateTime? LastActivityTimestamp { get; set; }
}
