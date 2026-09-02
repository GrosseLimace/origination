using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record SetBidSheetPreferenceRequest
{
    [Required, MaxLength(500)]
    public string TradeUnitKey { get; init; } = string.Empty;

    [MaxLength(50)]
    public string? CropCode { get; init; }

    public int? Month { get; init; }
    public int? CropYear { get; init; }
    public string? CropOrder { get; init; }
    public string? HiddenCrops { get; init; }
    public string? SelectedMonths { get; init; }

    /// <summary>JSON array of crop years shown in the Edit Bids grid. Null leaves the stored value alone.</summary>
    public string? SelectedYears { get; init; }
    public string? PrintLayout { get; init; }

    [MaxLength(10)]
    public string? PriceMode { get; init; }
}
