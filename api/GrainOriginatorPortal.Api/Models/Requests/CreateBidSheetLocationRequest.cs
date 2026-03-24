using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class CreateBidSheetLocationRequest
{
    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(300)]
    public string? Address { get; set; }

    [MaxLength(100)]
    public string? City { get; set; }

    [MaxLength(10)]
    public string? State { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    [MaxLength(50)]
    public string? ElevatorCode { get; set; }

    [Required, MaxLength(100)]
    public string TradeUnitCode { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? GroupName { get; set; }

    public List<UpsertBidSheetBidRequest> Bids { get; set; } = [];
}
