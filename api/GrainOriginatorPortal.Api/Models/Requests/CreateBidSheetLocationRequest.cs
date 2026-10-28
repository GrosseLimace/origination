using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateBidSheetLocationRequest
{
    [Required, MaxLength(200)]
    public string Name { get; init; } = string.Empty;

    [MaxLength(300)]
    public string? Address { get; init; }

    [MaxLength(100)]
    public string? City { get; init; }

    [MaxLength(10)]
    public string? State { get; init; }

    public double? Latitude { get; init; }
    public double? Longitude { get; init; }

    [MaxLength(50)]
    public string? ElevatorCode { get; init; }

    /// <summary>
    /// BarChart location key to link this placement to the feed. When supplied, missing address and
    /// coordinate fields are filled from the catalog and fed bids are published immediately, so the
    /// location does not sit blank until the next pipeline run.
    /// </summary>
    [MaxLength(50)]
    public string? BarchartLocationKey { get; init; }

    /// <summary>
    /// Provenance only -- which desk first added this location. Locations are company-wide, so this
    /// is no longer a scope key and nothing requires it; the manual-add flow and the BarChart picker
    /// both create locations with no trade unit in view.
    /// </summary>
    [MaxLength(100)]
    public string? TradeUnitCode { get; init; }

    [MaxLength(200)]
    public string? GroupName { get; init; }

    public bool IsScoularFacility { get; init; }

    public List<UpsertBidSheetBidRequest> Bids { get; init; } = [];
}
