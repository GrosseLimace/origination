namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Translates a BarChart commodity display name to a Scoular commodity code, so fed bids land in the
/// right crop column on the Bid Sheet. The vendor's commodity <em>string</em> is the key — the symbol's
/// commodity root can't distinguish "Corn (#2 Yellow)" from "Corn (NonGMO)", and those two bid
/// differently at the same elevator.
///
/// Ships empty and is maintained by the business (add a row, no deploy needed). A vendor commodity with
/// no active row here is still ingested and stored, it just never reaches the Bid Sheet — so an
/// unmapped commodity is invisible rather than guessed at.
/// </summary>
public class BarchartCommodityMap
{
    /// <summary>Vendor commodity display name exactly as it arrives, e.g. "Corn (#2 Yellow)". Primary key.</summary>
    public string BarchartCommodity { get; set; } = string.Empty;

    /// <summary>Scoular commodity code the Bid Sheet grid is keyed by (matches <c>dbo.Commodities.Code</c>).</summary>
    public string CommodityCode { get; set; } = string.Empty;

    /// <summary>Our display name, copied onto the bid row for consistency with manually entered bids.</summary>
    public string? CommodityName { get; set; }

    /// <summary>Our category grouping, copied onto the bid row.</summary>
    public string? CommodityCategory { get; set; }

    /// <summary>Turn a mapping off without deleting it; inactive mappings stop feeding the Bid Sheet and their fed cells are pruned on the next bridge run.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
}
