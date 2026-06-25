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
    /// <summary>The persisted TradeUnitCode of a location, or null if it doesn't exist. Used to
    /// authorize mutations against the row's actual trade unit (not a client-supplied value).</summary>
    Task<string?> GetLocationTradeUnitCodeAsync(int id, CancellationToken cancellationToken);
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
        string? cropOrder, string? hiddenCrops, string? selectedMonths, string? printLayout, CancellationToken cancellationToken);
}
