namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class BidSheetPreference
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string TradeUnitKey { get; set; } = string.Empty;
    public string? CropCode { get; set; }
    public int? Month { get; set; }    // null=no preference, 0=yearly, 1-12=monthly
    public int? CropYear { get; set; } // null=no preference
    /// <summary>
    /// The Edit Bids columns, as a JSON array of picks in the order the user arranged them:
    /// <c>[{"c":"YC","y":2026,"m":12},{"c":"YC","y":2027,"m":1}]</c>. One pick is exactly one
    /// column, so a run that crosses a year boundary -- Dec 2026, Jan 2027, Feb 2027 -- is now
    /// expressible. It was not under the crop x month x year cross product this replaced, which
    /// could only ever produce every combination of the three, in its own order.
    ///
    /// Stored as picks rather than the client's packed "CROP#YEAR#MONTH" cell key on purpose: that
    /// key is already reconstructed in three places on the client, and making the database a fourth
    /// would tie the storage format to a UI detail.
    /// </summary>
    public string? SelectedColumns { get; set; }

    // ---- Superseded by SelectedColumns ----------------------------------------------------------
    // These four described the old cross product. Nothing writes them any more; they are read once,
    // to synthesise a column list for a user who has not opened the new grid yet, so nobody loses
    // their arrangement on upgrade. Kept rather than dropped so a rollback still finds it intact.

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
