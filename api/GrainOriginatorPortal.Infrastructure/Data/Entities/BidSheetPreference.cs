namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class BidSheetPreference
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string TradeUnitKey { get; set; } = string.Empty;
    public string? CropCode { get; set; }
    public int? Month { get; set; }    // null=no preference, 0=yearly, 1-12=monthly
    public int? CropYear { get; set; } // null=no preference
    public string? CropOrder { get; set; } // JSON array of crop codes, e.g. ["CORN","WHEAT"]
    public string? HiddenCrops { get; set; } // JSON array of deselected crop codes, e.g. ["MILO"]
    public string? SelectedMonths { get; set; } // JSON array of selected months, e.g. [4,5,6] or [0] for yearly
    public string? PrintLayout { get; set; } // JSON: print/export layout — { yearColumns:[{label,offset}], address, phone, highlightScoular }
    public DateTime ModifiedAt { get; set; }
}
