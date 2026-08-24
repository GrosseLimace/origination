using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class BidSheetService : IBidSheetService
{
    private readonly IBidSheetRepository _repository;
    private readonly IRequestContextService _requestContext;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IBarchartCatalogRepository _barchartCatalog;
    private readonly IBarchartIngestRepository _barchartIngest;

    public BidSheetService(
        IBidSheetRepository repository,
        IRequestContextService requestContext,
        IUserEntitlementService entitlementService,
        IBarchartCatalogRepository barchartCatalog,
        IBarchartIngestRepository barchartIngest)
    {
        _repository = repository;
        _requestContext = requestContext;
        _entitlementService = entitlementService;
        _barchartCatalog = barchartCatalog;
        _barchartIngest = barchartIngest;
    }

    /// <summary>Authorizes a mutation against the target location's PERSISTED trade unit (not a
    /// client-supplied value), closing the IDOR where a caller passes a TU they're entitled to but
    /// targets a location id in a different TU. Returns false if the location doesn't exist (so the
    /// caller can surface a 404/no-op); throws ForbiddenException if the caller isn't entitled to
    /// the row's trade unit.</summary>
    private async Task<bool> AuthorizeLocationByStoredTradeUnitAsync(int locationId, CancellationToken cancellationToken)
    {
        var storedTradeUnit = await _repository.GetLocationTradeUnitCodeAsync(locationId, cancellationToken);
        if (string.IsNullOrEmpty(storedTradeUnit)) return false;
        await _entitlementService.ValidateTradeUnitsOrThrowAsync([storedTradeUnit], cancellationToken);
        return true;
    }

    /// <inheritdoc />
    public async Task<List<ElevatorCacheResponse>> GetElevatorsAsync(string? tradeUnitCode, CancellationToken cancellationToken)
    {
        var elevators = await _repository.GetElevatorsAsync(tradeUnitCode, cancellationToken);
        return elevators.Select(e => e.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<BidSheetLocationResponse>> GetLocationsAsync(string? tradeUnitCode, CancellationToken cancellationToken)
    {
        var locations = string.IsNullOrWhiteSpace(tradeUnitCode)
            ? await _repository.GetAllLocationsAsync(cancellationToken)
            : await _repository.GetLocationsAsync(tradeUnitCode, cancellationToken);
        return locations.Select(l => l.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<BidSheetLocationResponse> CreateLocationAsync(CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        // Friendly guard for the unique (Name, TradeUnitCode) index: surface a clear validation
        // message (→ 400) instead of a generic 500 when the name is already taken in this trade unit.
        if (await _repository.LocationNameExistsAsync(request.Name, request.TradeUnitCode, cancellationToken))
            throw new ValidationException("name",
                $"A location named \"{request.Name.Trim()}\" already exists in this trade unit. Use a different name.");

        // Resolved before anything is written so a bad link fails as a 400 rather than leaving an
        // unlinked location behind.
        var barchartLocation = await ResolveBarchartLocationAsync(request, cancellationToken);

        var user = _requestContext.GetCurrentUser();
        var now = DateTime.UtcNow;
        var location = new BidSheetLocation
        {
            Name = request.Name,
            // Fall back to the vendor's record for anything the caller left blank: adding from the picker
            // sends little more than a key, and a location with no coordinates never gets a map pin.
            Address = request.Address ?? barchartLocation?.Address,
            City = request.City ?? barchartLocation?.City,
            State = request.State ?? barchartLocation?.State,
            Latitude = request.Latitude ?? barchartLocation?.Latitude,
            Longitude = request.Longitude ?? barchartLocation?.Longitude,
            ElevatorCode = request.ElevatorCode,
            // Taken from the catalog, not the request, so the stored key is always canonical.
            BarchartLocationKey = barchartLocation?.LocationKey,
            TradeUnitCode = request.TradeUnitCode,
            GroupName = request.GroupName,
            IsScoularFacility = request.IsScoularFacility,
            CreatedBy = user,
            CreatedAt = now,
            Bids = request.Bids.Select(b => new BidSheetLocationBid
            {
                CommodityCode = b.CommodityCode,
                CommodityName = b.CommodityName,
                CommodityCategory = b.CommodityCategory,
                CropYear = b.CropYear,
                Month = b.Month,
                Bid = b.Bid,
                CreatedBy = user,
                CreatedAt = now
            }).ToList()
        };

        var created = await _repository.CreateLocationAsync(location, cancellationToken);
        if (barchartLocation is null) return created.ToResponse();

        // Publish the feed's current prices immediately, so a location added from the picker shows its
        // bids right away instead of looking empty until the next pipeline run.
        await _barchartIngest.ApplyBidsToBidSheetAsync(
            created.Id, BarchartFeedDefaults.InstrumentType, BarchartFeedDefaults.Actor,
            cancellationToken: cancellationToken);

        var withFedBids = await _repository.GetLocationAsync(created.Id, cancellationToken);
        return (withFedBids ?? created).ToResponse();
    }

    /// <summary>
    /// Validates a requested BarChart link and returns the catalog listing it points at, or null when the
    /// request isn't a feed link. Rejects unknown keys and a second link to the same location in one trade
    /// unit, which would put duplicate fed bids on the sheet.
    /// </summary>
    private async Task<BarchartLocationSummary?> ResolveBarchartLocationAsync(
        CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.BarchartLocationKey)) return null;

        var key = request.BarchartLocationKey.Trim();

        if (await _repository.BarchartLocationLinkedAsync(key, request.TradeUnitCode, cancellationToken))
            throw new ValidationException("barchartLocationKey",
                "This BarChart location is already on this trade unit's bid sheet.");

        return await _barchartCatalog.GetLocationAsync(key, cancellationToken)
            ?? throw new ValidationException("barchartLocationKey",
                "That BarChart location is no longer in the feed. Refresh the list and try again.");
    }

    /// <inheritdoc />
    public async Task<BidSheetLocationResponse?> UpdateLocationAsync(int id, CreateBidSheetLocationRequest request, CancellationToken cancellationToken)
    {
        // Authorize against the location's stored trade unit, not request.TradeUnitCode (AR-05 fix).
        if (!await AuthorizeLocationByStoredTradeUnitAsync(id, cancellationToken))
            return null;

        var location = new BidSheetLocation
        {
            Name = request.Name,
            Address = request.Address,
            City = request.City,
            State = request.State,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            IsScoularFacility = request.IsScoularFacility,
            ModifiedBy = _requestContext.GetCurrentUser()
        };

        var updated = await _repository.UpdateLocationAsync(id, location, cancellationToken);
        return updated?.ToResponse();
    }

    /// <inheritdoc />
    public async Task DeleteLocationAsync(int id, CancellationToken cancellationToken)
    {
        // Authorize against the location's stored trade unit (not a client value); no-op if missing.
        if (!await AuthorizeLocationByStoredTradeUnitAsync(id, cancellationToken)) return;
        await _repository.DeleteLocationAsync(id, cancellationToken);
    }

    /// <inheritdoc />
    public async Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken)
    {
        // Authorize against the parent location's stored trade unit (not a client value); no-op if missing.
        if (!await AuthorizeLocationByStoredTradeUnitAsync(locationId, cancellationToken)) return;
        await _repository.DeleteBidsAsync(locationId, commodityCode, month, cancellationToken);
    }

    /// <inheritdoc />
    public async Task BulkUpsertBidsAsync(List<UpsertBidSheetBidRequest> requests, CancellationToken cancellationToken)
    {
        var user = _requestContext.GetCurrentUser();
        // Group by trade unit and upsert each set in its own repository transaction.
        foreach (var group in requests.GroupBy(r => r.TradeUnitCode ?? string.Empty))
        {
            if (string.IsNullOrEmpty(group.Key)) continue;
            var inputs = group.Select(r => new BidUpsertInput
            {
                Name = r.Name,
                ElevatorCode = r.ElevatorCode,
                GroupName = r.GroupName,
                Latitude = r.Latitude,
                Longitude = r.Longitude,
                CommodityCode = r.CommodityCode,
                CommodityName = r.CommodityName,
                CommodityCategory = r.CommodityCategory,
                CropYear = r.CropYear,
                Month = r.Month,
                Bid = r.Bid
            }).ToList();
            await _repository.BulkUpsertBidsAsync(inputs, group.Key, user, cancellationToken);
        }
    }

    /// <inheritdoc />
    public Task<List<int>> GetCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken) =>
        _repository.GetBidCropYearsAsync(tradeUnitCode, cancellationToken);

    /// <inheritdoc />
    public Task<List<string>> GetCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken) =>
        _repository.GetBidCommoditiesAsync(tradeUnitCode, cancellationToken);

    /// <inheritdoc />
    public Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken) =>
        _repository.GetBidMonthsAsync(tradeUnitCode, cropYear, cancellationToken);

    /// <inheritdoc />
    public async Task<BidSheetLocationOrderResponse?> GetLocationOrderAsync(string tradeUnitKey, CancellationToken cancellationToken)
    {
        var order = await _repository.GetLocationOrderAsync(_requestContext.GetCurrentUser(), tradeUnitKey, cancellationToken);
        return order?.ToResponse();
    }

    /// <inheritdoc />
    public Task SetLocationOrderAsync(string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken) =>
        _repository.SetLocationOrderAsync(_requestContext.GetCurrentUser(), tradeUnitKey, locationOrderJson, cancellationToken);

    /// <inheritdoc />
    public async Task<BidSheetPreferenceResponse?> GetPreferenceAsync(string tradeUnitKey, CancellationToken cancellationToken)
    {
        var pref = await _repository.GetPreferenceAsync(_requestContext.GetCurrentUser(), tradeUnitKey, cancellationToken);
        return pref?.ToResponse();
    }

    /// <inheritdoc />
    public Task SetPreferenceAsync(string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder,
        string? hiddenCrops, string? selectedMonths, string? printLayout, string? priceMode,
        CancellationToken cancellationToken) =>
        _repository.SetPreferenceAsync(_requestContext.GetCurrentUser(), tradeUnitKey, cropCode, month, cropYear,
            cropOrder, hiddenCrops, selectedMonths, printLayout, priceMode, cancellationToken);
}
