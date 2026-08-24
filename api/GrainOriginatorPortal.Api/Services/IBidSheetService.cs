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
        string? hiddenCrops, string? selectedMonths, string? printLayout, string? priceMode,
        CancellationToken cancellationToken);
}
