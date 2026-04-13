namespace GrainOriginatorPortal.Api.Models;

public class BidSheetPreference
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string TradeUnitKey { get; set; } = string.Empty;
    public string? CropCode { get; set; }
    public int? Month { get; set; }    // null=no preference, 0=yearly, 1-12=monthly
    public int? CropYear { get; set; } // null=no preference
    public DateTime ModifiedAt { get; set; }
}
