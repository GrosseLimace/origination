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

    [Required, MaxLength(100)]
    public string TradeUnitCode { get; init; } = string.Empty;

    [MaxLength(200)]
    public string? GroupName { get; init; }

    public bool IsScoularFacility { get; init; }

    public List<UpsertBidSheetBidRequest> Bids { get; init; } = [];
}
