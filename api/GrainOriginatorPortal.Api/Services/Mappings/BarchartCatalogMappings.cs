using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the BarChart catalog (picker) reads.</summary>
public static class BarchartCatalogMappings
{
    /// <param name="distanceMiles">Distance from the searched map centre, or null for a non-geographic search.</param>
    public static BarchartCatalogLocationResponse ToResponse(this BarchartLocationSummary l, double? distanceMiles) => new()
    {
        LocationKey = l.LocationKey,
        Elevator = l.Elevator,
        LocationName = l.LocationName,
        FacilityType = l.FacilityType,
        Address = l.Address,
        City = l.City,
        State = l.State,
        ZipCode = l.ZipCode,
        Latitude = l.Latitude,
        Longitude = l.Longitude,
        Phone = l.Phone,
        Website = l.Website,
        // Counts come back from SQL as bigint; they are per-site instrument counts, so int is ample.
        InstrumentCount = (int)l.ActiveInstrumentCount,
        CommodityCount = (int)l.CommodityCount,
        LatestQuoteAsOf = l.LatestQuoteTimestamp,
        DistanceMiles = distanceMiles.HasValue ? Math.Round(distanceMiles.Value, 1) : null,
    };

    public static BarchartCatalogBidResponse ToResponse(this BarchartBidPreview b) => new()
    {
        CommodityCode = b.CommodityCode,
        VendorCommodity = b.VendorCommodity,
        CropYear = b.CropYear,
        Month = b.Month,
        Price = b.Price,
        QuoteAsOf = b.QuoteAsOf,
        Symbol = b.Symbol,
        IsMapped = b.IsMapped,
    };

    public static BarchartCatalogPlacementResponse ToResponse(this BarchartLocationPlacement p) => new()
    {
        LocationId = p.LocationId,
        TradeUnitCode = p.TradeUnitCode,
        GroupName = p.GroupName,
        Name = p.Name,
    };

    public static BarchartCoverageResponse ToResponse(this BarchartCoverage c) => new()
    {
        LocationCount = c.LocationCount,
        LastRefreshedUtc = c.LastRefreshedUtc,
        States = c.States
            .Select(s => new BarchartStateCoverageResponse { State = s.State, LocationCount = s.LocationCount })
            .ToList(),
    };
}
