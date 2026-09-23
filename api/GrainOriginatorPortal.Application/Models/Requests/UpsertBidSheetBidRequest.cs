using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Used for both initial bid creation and bulk-upsert (edit bids grid).</summary>
public record UpsertBidSheetBidRequest
{
    /// <summary>Location identity — matched by (Name + TradeUnitCode) or (ElevatorCode + TradeUnitCode). Required for bulk upsert; ignored on location-scoped create.</summary>
    [MaxLength(200)]
    public string? Name { get; init; }

    [MaxLength(50)]
    public string? ElevatorCode { get; init; }

    [MaxLength(100)]
    public string? TradeUnitCode { get; init; }

    [MaxLength(200)]
    public string? GroupName { get; init; }

    public double? Latitude { get; init; }
    public double? Longitude { get; init; }

    // Bid data
    [Required, MaxLength(50)]
    public string CommodityCode { get; init; } = string.Empty;

    [MaxLength(200)]
    public string? CommodityName { get; init; }

    [MaxLength(100)]
    public string? CommodityCategory { get; init; }

    [Required]
    public int CropYear { get; init; }

    public int Month { get; init; } = 0; // 0=yearly, 1-12=monthly

    [MaxLength(50)]
    public string Bid { get; init; } = string.Empty;
}
