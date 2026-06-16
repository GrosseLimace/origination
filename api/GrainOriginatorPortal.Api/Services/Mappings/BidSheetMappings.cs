using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the bid-sheet domain.</summary>
public static class BidSheetMappings
{
    public static ElevatorCacheResponse ToResponse(this ElevatorCache e) => new()
    {
        ElevatorCode = e.ElevatorCode,
        ElevatorShortName = e.ElevatorShortName,
        ElevatorName = e.ElevatorName,
        Address = e.Address,
        City = e.City,
        State = e.State,
        ZipCode = e.ZipCode,
        OurFacility = e.OurFacility,
        TradeUnitCode = e.TradeUnitCode,
        Latitude = e.Latitude,
        Longitude = e.Longitude,
        IsActive = e.IsActive,
        LastRefreshedAt = e.LastRefreshedAt,
    };

    public static BidSheetLocationBidResponse ToResponse(this BidSheetLocationBid b) => new()
    {
        Id = b.Id,
        LocationId = b.LocationId,
        CommodityCode = b.CommodityCode,
        CommodityName = b.CommodityName,
        CommodityCategory = b.CommodityCategory,
        CropYear = b.CropYear,
        Month = b.Month,
        Bid = b.Bid,
        CreatedBy = b.CreatedBy,
        CreatedAt = b.CreatedAt,
        ModifiedBy = b.ModifiedBy,
        ModifiedAt = b.ModifiedAt,
    };

    public static BidSheetLocationResponse ToResponse(this BidSheetLocation l) => new()
    {
        Id = l.Id,
        Name = l.Name,
        Address = l.Address,
        City = l.City,
        State = l.State,
        Latitude = l.Latitude,
        Longitude = l.Longitude,
        ElevatorCode = l.ElevatorCode,
        TradeUnitCode = l.TradeUnitCode,
        GroupName = l.GroupName,
        IsScoularFacility = l.IsScoularFacility,
        CreatedBy = l.CreatedBy,
        CreatedAt = l.CreatedAt,
        ModifiedBy = l.ModifiedBy,
        ModifiedAt = l.ModifiedAt,
        Bids = l.Bids.Select(b => b.ToResponse()).ToList(),
    };

    public static BidSheetLocationOrderResponse ToResponse(this BidSheetLocationOrder o) => new()
    {
        Id = o.Id,
        UserId = o.UserId,
        TradeUnitKey = o.TradeUnitKey,
        LocationOrder = o.LocationOrder,
        ModifiedAt = o.ModifiedAt,
    };

    public static BidSheetPreferenceResponse ToResponse(this BidSheetPreference p) => new()
    {
        Id = p.Id,
        UserId = p.UserId,
        TradeUnitKey = p.TradeUnitKey,
        CropCode = p.CropCode,
        Month = p.Month,
        CropYear = p.CropYear,
        CropOrder = p.CropOrder,
        HiddenCrops = p.HiddenCrops,
        SelectedMonths = p.SelectedMonths,
        PrintLayout = p.PrintLayout,
        ModifiedAt = p.ModifiedAt,
    };
}
