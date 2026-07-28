using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>Values for <see cref="BidSheetLocationBid.Source"/> — who owns a bid cell.</summary>
public static class BidSources
{
    /// <summary>Entered by a user; the BarChart feed never touches these rows.</summary>
    public const string Manual = "Manual";

    /// <summary>Written by the BarChart bridge; read-only to users (server-enforced).</summary>
    public const string Barchart = "Barchart";
}

public class BidSheetLocationBid
{
    public int Id { get; set; }
    public int LocationId { get; set; }
    public string CommodityCode { get; set; } = string.Empty;
    public string? CommodityName { get; set; }
    public string? CommodityCategory { get; set; }
    public int CropYear { get; set; }
    public int Month { get; set; } // 0=yearly, 1-12=monthly
    public string Bid { get; set; } = string.Empty;

    /// <summary>Who owns this cell: <see cref="BidSources.Manual"/> (user) or <see cref="BidSources.Barchart"/> (feed).</summary>
    public string Source { get; set; } = BidSources.Manual;

    /// <summary>The barchart.Instrument symbol that fed this cell (feed-owned rows only).</summary>
    public string? BarchartSymbol { get; set; }

    /// <summary>UTC time the elevator last updated the fed bid — the "as of" shown in the UI.</summary>
    public DateTime? QuoteAsOf { get; set; }

    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    [JsonIgnore]
    public BidSheetLocation Location { get; set; } = null!;
}
