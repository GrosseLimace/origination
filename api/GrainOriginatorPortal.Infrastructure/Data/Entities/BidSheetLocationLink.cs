namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One location on one sheet, in the position the user dragged it to.
///
/// This replaces <c>dbo.BidSheetLocationOrders</c>, which stored a JSON array of location ids keyed by
/// user and trade unit. Two problems with that shape are fixed by making it a row: the order was
/// per-user so it could not be shared, and it was a blob of ids with no foreign key — deleting a
/// location left a dangling id that the client silently skipped, so a saved arrangement quietly
/// degraded instead of failing.
///
/// The link cascades from the sheet (delete a sheet, its contents go) but RESTRICTS on the location.
/// Deleting an elevator is allowed -- the user is shown how many sheets hold it and confirms -- but
/// the delete path has to clear these links itself. The restrict is there so that no OTHER path can
/// empty somebody's sheet as a side effect it never meant to have.
/// </summary>
public class BidSheetLocationLink
{
    public int Id { get; set; }

    public int BidSheetId { get; set; }

    public int BidSheetLocationId { get; set; }

    /// <summary>Position in the grid. Gaps are fine; only the relative order is read.</summary>
    public int SortOrder { get; set; }

    public string AddedBy { get; set; } = string.Empty;
    public DateTime AddedAt { get; set; }

    public BidSheet? BidSheet { get; set; }
    public BidSheetLocation? Location { get; set; }
}
