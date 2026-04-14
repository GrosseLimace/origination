using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public class SetBidSheetPreferenceRequest
{
    [Required, MaxLength(500)]
    public string TradeUnitKey { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? CropCode { get; set; }

    public int? Month { get; set; }
    public int? CropYear { get; set; }
    public string? CropOrder { get; set; }
    public string? HiddenCrops { get; set; }
    public string? SelectedMonths { get; set; }
}
