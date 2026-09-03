namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// One bid a BarChart location currently publishes, as the picker's confirm step previews it — so an
/// originator can see what will land on their Bid Sheet before committing to add the location.
/// </summary>
public record BarchartBidPreview
{
    /// <summary>Scoular commodity code the vendor commodity maps to. Null when the commodity isn't mapped yet.</summary>
    public string? CommodityCode { get; init; }

    /// <summary>Vendor's own commodity name, shown when no mapping exists so the gap is visible rather than silent.</summary>
    public string VendorCommodity { get; init; } = string.Empty;

    public int CropYear { get; init; }

    /// <summary>Delivery month, 1-12.</summary>
    public int Month { get; init; }

    /// <summary>Posted price in $/bu. Null when the catalog has the instrument but no quote yet.</summary>
    public decimal? Price { get; init; }

    /// <summary>When the elevator last updated this bid (UTC).</summary>
    public DateTime? QuoteAsOf { get; init; }

    public string Symbol { get; init; } = string.Empty;

    /// <summary>False when the commodity has no active mapping — this bid will not reach the Bid Sheet.</summary>
    public bool IsMapped { get; init; }

    /// <summary>True for a basis instrument, false for cash -- see BarchartFeedDefaults.InstrumentType
    /// / BasisInstrumentType. Cash and basis publish as separate instruments with independent quotes
    /// for the same commodity/period, so a caller matching "the" bid for one has to filter on this.</summary>
    public bool IsBasis { get; init; }

    /// <summary>
    /// Half-month split marker (F = first half, L = last half) or null for a whole month. Used to rank
    /// competing instruments the same way the bridge does, so the preview shows one row per Bid Sheet
    /// cell instead of every window that overlaps it.
    /// </summary>
    public string? DeliveryWindowFlag { get; init; }

    /// <summary>Start of the vendor delivery window (UTC); part of the same ranking.</summary>
    public DateTime? DeliveryStart { get; init; }

    /// <summary>End of the vendor delivery window (UTC); part of the same ranking.</summary>
    public DateTime? DeliveryEnd { get; init; }
}
