using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Used for both initial bid creation and bulk-upsert (edit bids grid).</summary>
public class UpsertBidSheetBidRequest
{
    /// <summary>Location identity — matched by (Name + TradeUnitCode) or (ElevatorCode + TradeUnitCode). Required for bulk upsert; ignored on location-scoped create.</summary>
    [MaxLength(200)]
    public string? Name { get; set; }

    [MaxLength(50)]
    public string? ElevatorCode { get; set; }

    [MaxLength(100)]
    public string? TradeUnitCode { get; set; }

    [MaxLength(200)]
    public string? GroupName { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    // Bid data
    [Required, MaxLength(50)]
    public string CommodityCode { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? CommodityName { get; set; }

    [MaxLength(100)]
    public string? CommodityCategory { get; set; }

    [Required]
    public int CropYear { get; set; }

    [Required, MaxLength(50)]
    public string Bid { get; set; } = string.Empty;
}
