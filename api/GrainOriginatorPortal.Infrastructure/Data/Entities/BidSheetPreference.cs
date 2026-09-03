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

    /// <summary>JSON array of the crop years shown in the Edit Bids grid, e.g. [2026,2027].</summary>
    public string? SelectedYears { get; set; }
    public string? PrintLayout { get; set; }
    /// <summary>Which price the sheet was last showing: "cash" or "basis". Null = never chosen.</summary>
    /// <summary>
    /// The sheet this user last had open, so the screen reopens where they left it.
    ///
    /// Per-user on purpose, unlike everything else about a sheet: which sheet you are looking at is
    /// yours, while the sheet's own columns and row order are shared with everyone on it. Stored on
    /// the "__global__" preference row -- it is not per-desk, and there are no desks here any more.
    /// </summary>
    public int? SelectedBidSheetId { get; set; }

    public string? PriceMode { get; set; } // JSON: print/export layout — { yearColumns:[{label,offset}], address, phone, highlightScoular }
    public DateTime ModifiedAt { get; set; }
}
