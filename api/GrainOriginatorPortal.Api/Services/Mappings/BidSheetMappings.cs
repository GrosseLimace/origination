using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

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
        Source = b.Source,
        BarchartSymbol = b.BarchartSymbol,
        QuoteAsOf = b.QuoteAsOf,
        BasisBid = b.BasisBid,
        BasisSymbol = b.BasisSymbol,
        UnderlyingFuture = b.UnderlyingFuture,
        BasisQuoteAsOf = b.BasisQuoteAsOf,
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
        BarchartLocationKey = l.BarchartLocationKey,
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
        SelectedYears = p.SelectedYears,
        PrintLayout = p.PrintLayout,
        PriceMode = p.PriceMode,
        ModifiedAt = p.ModifiedAt,
    };

    /// <summary>
    /// A sheet with its shares and, in row order, the locations behind its links.
    ///
    /// <paramref name="callerUserId"/> decides <c>IsOwner</c>. It is passed rather than read from the
    /// entity so the mapping stays a pure function of what it is given, matching every other mapping
    /// here; the service is the only place that knows who is asking.
    /// </summary>
    public static BidSheetResponse ToResponse(this BidSheet s, string callerUserId) => new()
    {
        Id = s.Id,
        Name = s.Name,
        OwnerUserId = s.OwnerUserId,
        IsOwner = string.Equals(s.OwnerUserId, callerUserId, StringComparison.OrdinalIgnoreCase),
        CropOrder = s.CropOrder,
        HiddenCrops = s.HiddenCrops,
        SelectedMonths = s.SelectedMonths,
        SelectedYears = s.SelectedYears,
        CreatedBy = s.CreatedBy,
        CreatedAt = s.CreatedAt,
        ModifiedBy = s.ModifiedBy,
        ModifiedAt = s.ModifiedAt,
        Shares = s.Shares
            .OrderBy(sh => sh.MemberName ?? sh.MemberUserId, StringComparer.OrdinalIgnoreCase)
            .Select(sh => sh.ToResponse())
            .ToList(),
        // Order again here rather than trusting the include: a sheet built in memory (a fresh create,
        // a test) has no ordering applied, and a row order that only holds when it came from SQL is
        // the kind of thing that works until it quietly does not.
        Locations = s.Locations
            .OrderBy(l => l.SortOrder)
            .Where(l => l.Location != null)
            .Select(l => l.Location!.ToResponse())
            .ToList(),
    };

    public static BidSheetShareResponse ToResponse(this BidSheetShare sh) => new()
    {
        UserId = sh.MemberUserId,
        Name = sh.MemberName,
        SharedBy = sh.SharedBy,
        SharedAt = sh.SharedAt,
    };
}
