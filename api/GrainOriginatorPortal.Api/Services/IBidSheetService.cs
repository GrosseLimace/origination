using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Bid-sheet data: elevators, locations + bids, the concurrency-safe bulk upsert, metadata
/// lookups, and per-user location order / UI preferences. Writes are attributed to the current user.</summary>
public interface IBidSheetService
{
    Task<List<ElevatorCacheResponse>> GetElevatorsAsync(string? tradeUnitCode, CancellationToken cancellationToken);
    Task<List<BidSheetLocationResponse>> GetLocationsAsync(string? tradeUnitCode, CancellationToken cancellationToken);
    Task<BidSheetLocationResponse> CreateLocationAsync(CreateBidSheetLocationRequest request, CancellationToken cancellationToken);
    Task<BidSheetLocationResponse?> UpdateLocationAsync(int id, CreateBidSheetLocationRequest request, CancellationToken cancellationToken);
    Task DeleteLocationAsync(int id, CancellationToken cancellationToken);
    Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken);

    /// <summary>Bulk-upserts bids, grouped by trade unit (one repository transaction per TU).</summary>
    Task BulkUpsertBidsAsync(List<UpsertBidSheetBidRequest> requests, CancellationToken cancellationToken);

    Task<List<int>> GetCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<string>> GetCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken);

    Task<BidSheetLocationOrderResponse?> GetLocationOrderAsync(string tradeUnitKey, CancellationToken cancellationToken);
    Task SetLocationOrderAsync(string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken);

    Task<BidSheetPreferenceResponse?> GetPreferenceAsync(string tradeUnitKey, CancellationToken cancellationToken);
    Task SetPreferenceAsync(string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder,
        string? hiddenCrops, string? selectedMonths, string? selectedYears, string? printLayout, string? priceMode,
        CancellationToken cancellationToken);

    // ---- Sheets --------------------------------------------------------------------------------
    // A sheet is a named, shareable working set of locations. Everyone on a sheet can edit its
    // contents; only the owner can rename it, reshare it, or delete it.

    /// <summary>Sheets the caller owns or is shared on, ordered by name.</summary>
    Task<List<BidSheetResponse>> GetSheetsAsync(CancellationToken cancellationToken);

    /// <summary>One sheet the caller can see. Throws NotFound when it does not exist and Forbidden
    /// when it exists but is not theirs -- a genuine outsider gets a 403, not a 404 that reads like
    /// the sheet was deleted.</summary>
    Task<BidSheetResponse> GetSheetAsync(int sheetId, CancellationToken cancellationToken);

    Task<BidSheetResponse> CreateSheetAsync(BidSheetRequest request, CancellationToken cancellationToken);

    /// <summary>Renames a sheet. Owner only.</summary>
    Task<BidSheetResponse> RenameSheetAsync(int sheetId, BidSheetRequest request, CancellationToken cancellationToken);

    /// <summary>Saves the shared column layout. Any member may; the layout IS the shared view.</summary>
    Task<BidSheetResponse> SetSheetLayoutAsync(int sheetId, BidSheetLayoutRequest request, CancellationToken cancellationToken);

    /// <summary>Deletes a sheet and its shares and links. Owner only. The locations survive.</summary>
    Task DeleteSheetAsync(int sheetId, CancellationToken cancellationToken);

    /// <summary>Replaces who the sheet is shared with. Owner only.</summary>
    Task<BidSheetResponse> SetSheetSharesAsync(int sheetId, BidSheetSharesRequest request, CancellationToken cancellationToken);

    /// <summary>Puts an existing company-wide location on the sheet. Any member may.</summary>
    Task<BidSheetResponse> AddSheetLocationAsync(int sheetId, AddBidSheetLocationRequest request, CancellationToken cancellationToken);

    /// <summary>Takes a location off the sheet. The location itself is untouched.</summary>
    Task<BidSheetResponse> RemoveSheetLocationAsync(int sheetId, int locationId, CancellationToken cancellationToken);

    /// <summary>Saves the row order for the sheet. Any member may; the order is shared.</summary>
    Task<BidSheetResponse> SetSheetLocationOrderAsync(int sheetId, BidSheetLocationOrderRequest request, CancellationToken cancellationToken);

    /// <summary>How many sheets hold a location, for the delete confirmation.</summary>
    Task<int> CountSheetsHoldingLocationAsync(int locationId, CancellationToken cancellationToken);
}
