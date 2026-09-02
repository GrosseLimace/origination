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
    Task BulkUpsertBidsAsync(IEnumerable<BidUpsertInput> requests, string tradeUnitCode, string userId, CancellationToken cancellationToken);
    Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken);
    Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken);
    Task<BidSheetLocationOrder?> GetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken);
    Task SetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken);
    Task<BidSheetPreference?> GetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken);
    Task SetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear,
        string? cropOrder, string? hiddenCrops, string? selectedMonths, string? selectedYears, string? printLayout, string? priceMode, CancellationToken cancellationToken);
}
