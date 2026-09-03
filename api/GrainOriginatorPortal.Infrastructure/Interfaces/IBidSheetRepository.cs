using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for bid-sheet data in the Origination database: the elevator cache, bid-sheet
/// locations and their bids (incl. the concurrency-safe bulk upsert), and per-user location
/// order / UI preferences. Response caching for the elevator lookup is the caller's concern;
/// the owning user id is passed in.
/// </summary>
public interface IBidSheetRepository
{
    Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode, CancellationToken cancellationToken);
    Task<List<BidSheetLocation>> GetLocationsAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<BidSheetLocation>> GetAllLocationsAsync(CancellationToken cancellationToken);
    /// <summary>
    /// The persisted CreatedBy of a location, or null if it doesn't exist. Authorizes the two
    /// destructive operations against who actually made the row, rather than against a value the
    /// caller supplied.
    /// </summary>
    Task<string?> GetLocationCreatedByAsync(int id, CancellationToken cancellationToken);
    /// <summary>True if a location with this name already exists in the trade unit (matches the
    /// unique (Name, TradeUnitCode) index). Lets the service surface a friendly duplicate-name error.</summary>
    Task<bool> LocationNameExistsAsync(string name, string tradeUnitCode, CancellationToken cancellationToken);
    /// <summary>True if this trade unit is already linked to the given BarChart location. Keeps a
    /// user from adding the same feed location twice to one trade unit, which would duplicate every
    /// fed bid on the sheet.</summary>
    Task<bool> BarchartLocationLinkedAsync(string barchartLocationKey, string tradeUnitCode, CancellationToken cancellationToken);
    /// <summary>A single location with its bids, or null. Used to return a freshly linked location
    /// after the feed bridge has filled in its bids.</summary>
    Task<BidSheetLocation?> GetLocationAsync(int id, CancellationToken cancellationToken);
    Task<BidSheetLocation> CreateLocationAsync(BidSheetLocation location, CancellationToken cancellationToken);
    Task<BidSheetLocation?> UpdateLocationAsync(int id, BidSheetLocation location, CancellationToken cancellationToken);
    Task DeleteLocationAsync(int id, CancellationToken cancellationToken);
    Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken);
    /// <summary>
    /// Writes bid cells. Each input names its location by id; a name is accepted as a fallback and
    /// resolved company-wide. An input that resolves to nothing is rejected rather than silently
    /// creating a location -- that implicit-create path was safe only while a trade unit made the
    /// name lookup deterministic.
    /// </summary>
    Task BulkUpsertBidsAsync(IEnumerable<BidUpsertInput> requests, string userId, CancellationToken cancellationToken);
    Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken);
    Task<BidSheetLocationOrder?> GetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken);
    Task SetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken);
    Task<BidSheetPreference?> GetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken);
    Task SetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear,
        string? cropOrder, string? hiddenCrops, string? selectedMonths, string? selectedYears, string? printLayout, string? priceMode, CancellationToken cancellationToken);

    // ---- Sheets --------------------------------------------------------------------------------
    // A sheet is a named, shareable working set of locations. It replaced the trade unit as the thing
    // that decides what the screen shows, so these are the reads the screen boots from.

    /// <summary>Sheets the caller owns or has been shared on, with shares and location links
    /// (locations themselves included), ordered by name.</summary>
    Task<List<BidSheet>> GetVisibleSheetsAsync(string userId, CancellationToken cancellationToken);

    /// <summary>One sheet the caller owns or is shared on, fully loaded, or null when it does not
    /// exist OR they cannot see it. The service turns those two cases into 404 and 403 separately,
    /// so it asks <see cref="SheetExistsAsync"/> before deciding.</summary>
    Task<BidSheet?> GetVisibleSheetAsync(int sheetId, string userId, CancellationToken cancellationToken);

    /// <summary>True if the sheet row exists at all, regardless of who can see it. Lets the service
    /// answer 403 for a real sheet the caller is not on, rather than the recap-group style 404 that
    /// makes every denial look like a missing row.</summary>
    Task<bool> SheetExistsAsync(int sheetId, CancellationToken cancellationToken);

    /// <summary>True if this user already owns a sheet by this name (matches UQ_BidSheets_Owner_Name),
    /// so the service can return a friendly duplicate-name error instead of a unique-index violation.</summary>
    Task<bool> SheetNameExistsAsync(string ownerUserId, string name, int? excludeSheetId, CancellationToken cancellationToken);

    Task<BidSheet> CreateSheetAsync(BidSheet sheet, CancellationToken cancellationToken);

    /// <summary>Renames a sheet. Owner-checked by the caller; returns null if the row is gone.</summary>
    Task<BidSheet?> RenameSheetAsync(int sheetId, string name, string modifiedBy, CancellationToken cancellationToken);

    /// <summary>Saves the shared column layout (crop order, hidden crops, months, years). A null
    /// argument leaves that field alone, so the eight independent save paths on the screen do not
    /// have to send the whole layout to change one part of it.</summary>
    Task<BidSheet?> SetSheetLayoutAsync(int sheetId, string? cropOrder, string? hiddenCrops,
        string? selectedMonths, string? selectedYears, string modifiedBy, CancellationToken cancellationToken);

    /// <summary>Deletes a sheet and, by cascade, its shares and location links. The locations
    /// themselves are company-wide and are left alone.</summary>
    Task DeleteSheetAsync(int sheetId, CancellationToken cancellationToken);

    /// <summary>The sheet's owner id, or null if it does not exist. Delete and share changes are
    /// owner-only, checked against the persisted value rather than anything the caller sent.</summary>
    Task<string?> GetSheetOwnerAsync(int sheetId, CancellationToken cancellationToken);

    /// <summary>Replaces the share list wholesale. The owner is never stored as a share.</summary>
    Task<BidSheet?> SetSheetSharesAsync(int sheetId, List<BidSheetShare> shares, CancellationToken cancellationToken);

    /// <summary>Adds a location to a sheet at the end of the order. Idempotent -- adding one that is
    /// already on the sheet returns the existing link rather than violating the unique index, because
    /// two people can add the same elevator at the same moment.</summary>
    Task<BidSheetLocationLink> AddSheetLocationAsync(int sheetId, int locationId, string addedBy, CancellationToken cancellationToken);

    /// <summary>Removes a location from a sheet. The location itself survives -- it is company-wide
    /// and other sheets may hold it.</summary>
    Task RemoveSheetLocationAsync(int sheetId, int locationId, CancellationToken cancellationToken);

    /// <summary>Stores the row order for a sheet, replacing the per-user LocationOrder JSON. Ids not
    /// on the sheet are ignored; ones on the sheet but absent from the list keep their relative order
    /// at the end, so a stale client cannot silently drop rows off someone else's view.</summary>
    Task SetSheetLocationOrderAsync(int sheetId, IReadOnlyList<int> orderedLocationIds, CancellationToken cancellationToken);

    /// <summary>How many sheets hold this location. The delete confirmation says the number out loud,
    /// and the delete itself is refused while it is non-zero (the link FK is RESTRICT).</summary>
    Task<int> CountSheetsHoldingLocationAsync(int locationId, CancellationToken cancellationToken);
}
