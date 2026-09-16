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
    /// <summary>JSON: the print/export layout -- { yearColumns:[{label,offset}], address, phone,
    /// highlightScoular }.</summary>
    public string? PrintLayout { get; set; }

    /// <summary>
    /// The sheets this user last had open, as a JSON array of ids -- "[120,133]" -- so the screen
    /// reopens where they left it. Null or empty means none.
    ///
    /// A list rather than one id because several sheets can be shown together. It stays a JSON string
    /// for the same reason CropOrder and SelectedMonths do: it is read and written whole, never
    /// queried by element, so a column costs nothing and a join table would buy nothing.
    ///
    /// Per-user on purpose, unlike everything else about a sheet: which sheets you are looking at are
    /// yours, while a sheet's own columns and row order are shared with everyone on it. Stored on the
    /// "__global__" preference row -- it is not per-desk, and there are no desks here any more.
    /// </summary>
    public string? SelectedBidSheetIds { get; set; }

    /// <summary>Which price the sheet was last showing: "cash", "basis" or "both". Null = never chosen.</summary>
    public string? PriceMode { get; set; }
    public DateTime ModifiedAt { get; set; }
}
