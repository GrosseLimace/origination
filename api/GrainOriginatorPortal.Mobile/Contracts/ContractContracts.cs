namespace GrainOriginatorPortal.Mobile.Contracts;

/// <summary>
/// Schema <c>ContractCard</c> (card #645, collapsed). Dollar value is deliberately absent. Carries what the
/// desktop contracts table derives its row from (open balance, settled, signed, confirm status, pricing) so the
/// phone shows the same status, delivery and price as the desktop (user 2026-10-14: "like the desktop").
/// </summary>
public record ContractCardDto
{
    public required long Id { get; init; }
    public required string ContractNumber { get; init; }
    /// <summary>The CTRM contract id; the desktop shows it as the contract number when present.</summary>
    public string? SourceContractId { get; init; }
    public string? CommodityCode { get; init; }
    public string? CommodityDescription { get; init; }
    public decimal? Quantity { get; init; }
    public string? Unit { get; init; }
    public decimal? Price { get; init; }
    public string? PriceTypeCode { get; init; }
    public DateTime? ContractDate { get; init; }
    public DateTime? DeliveryStart { get; init; }
    public DateTime? DeliveryEnd { get; init; }
    public string? SpecialType { get; init; }
    /// <summary>The source status (e.g. "Cancelled"); the client derives Filled / Past Due / Active / To Arrive as the desktop does.</summary>
    public required string Status { get; init; }
    public decimal? OpenBalanceQuantity { get; init; }
    public decimal? SettledQuantity { get; init; }
    public bool Signed { get; init; }
    public string? CustomerConfirmStatus { get; init; }
    /// <summary>The desktop's pricing badge: Flat (with <see cref="CashPrice"/>), Priced, Partial, Unpriced (maybe with <see cref="BasisPrice"/>), Deferred.</summary>
    public required string PricingStatus { get; init; }
    public decimal? CashPrice { get; init; }
    public decimal? BasisPrice { get; init; }
}

/// <summary>Schema <c>ContractDetail</c> (card #645, expanded): the desktop's Contract / Pricing / Fulfillment detail.</summary>
public sealed record ContractDetailDto : ContractCardDto
{
    public int? CropYear { get; init; }
    public decimal? PricedQuantity { get; init; }
    /// <summary>Bushels still to price — unpriced contracts only (null otherwise), the desktop's rule.</summary>
    public decimal? UnpricedQuantity { get; init; }
    public string? BasisLocation { get; init; }
    public string? MarketZone { get; init; }
    public string? HedgeMarketMonth { get; init; }
    public required IReadOnlyList<PricingLineDto> PricingLines { get; init; }
}

/// <summary>Schema <c>PricingLine</c>: one row of the desktop's pricing-lines table.</summary>
public sealed record PricingLineDto
{
    public int? Sequence { get; init; }
    /// <summary>The quantity the desktop shows: a zero-quantity placeholder is the contract quantity or the unpriced remainder.</summary>
    public decimal? Quantity { get; init; }
    /// <summary>Flat price, else cash price (kept for older clients).</summary>
    public decimal? Price { get; init; }
    public decimal? FlatPrice { get; init; }
    public decimal? BasisPrice { get; init; }
    public decimal? HedgePrice { get; init; }
    public decimal? FreightAdjustment { get; init; }
    public DateTime? PriceDate { get; init; }
    /// <summary>The producer's confirm status for this line (the desktop's "Producer Confirm Status").</summary>
    public string? Status { get; init; }
    public string? MarketMonth { get; init; }
}
