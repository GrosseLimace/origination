namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A named list of bid sheet locations that one originator curates and can share with colleagues.
///
/// This replaced the trade unit as the thing that decides what the Bid Sheet screen shows. Locations
/// are company-wide now — everyone can see every elevator on the map — so a sheet is not a permission
/// boundary. It is a working set: the handful of elevators a person actually compares, in the order
/// and with the columns they want, which is what the trade-unit filter used to approximate badly.
///
/// Everyone on a sheet can edit it: add and remove locations, reorder rows, change the columns. Only
/// the owner can delete it, because a member deleting the owner's sheet out from under them is the
/// wrong default (the DailyRecapGroup precedent this follows draws the same line).
///
/// The column layout lives here rather than per-user, so a sheet IS the shared view — you set one up,
/// share it, and a colleague opens exactly what you arranged.
/// </summary>
public class BidSheet
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Owner. Short UPN ("CEgr"), matching entitlements and the display-name lookup.
    ///
    /// The codebase is split on this — SavedLists and BidSheetPreferences store a full UPN while
    /// DailyRecapGroupMembers and UserPreferences store the short form, and there is a helper whose
    /// only job is patching the seam. Short is the form the entitlements view speaks, so it is the one
    /// that needs no translation on the paths that matter here.
    /// </summary>
    public string OwnerUserId { get; set; } = string.Empty;

    // ---- Column layout, shared with everyone on the sheet -------------------------------------
    // JSON, matching how BidSheetPreferences already stores the same shapes.

    /// <summary>Crop codes in display order, e.g. ["HRWW","YC"].</summary>
    public string? CropOrder { get; set; }

    /// <summary>Crop codes hidden from the grid, e.g. ["SOR"].</summary>
    public string? HiddenCrops { get; set; }

    /// <summary>Selected months, where 0 is the Year column, e.g. [0,9,12].</summary>
    public string? SelectedMonths { get; set; }

    /// <summary>Selected crop years, e.g. [2026,2027].</summary>
    public string? SelectedYears { get; set; }

    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public DateTime? ModifiedAt { get; set; }

    public List<BidSheetShare> Shares { get; set; } = [];
    public List<BidSheetLocationLink> Locations { get; set; } = [];
}
