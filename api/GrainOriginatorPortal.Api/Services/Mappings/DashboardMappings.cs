using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the dashboard domain.</summary>
public static class DashboardMappings
{
    public static DashboardPlantingEstimateResponse ToResponse(this DashboardPlantingEstimate e) => new()
    {
        Id = e.Id,
        TradeUnitKey = e.TradeUnitKey,
        Crop = e.Crop,
        PlantingYear = e.PlantingYear,
        YieldEstimate = e.YieldEstimate,
        CreatedAt = e.CreatedAt,
        CreatedBy = e.CreatedBy,
        ModifiedAt = e.ModifiedAt,
        ModifiedBy = e.ModifiedBy,
    };

    public static DashboardMarketShareResponse ToResponse(this DashboardMarketShare m) => new()
    {
        Id = m.Id,
        TradeUnitKey = m.TradeUnitKey,
        CropCategory = m.CropCategory,
        PlantingYear = m.PlantingYear,
        MarketSharePct = m.MarketSharePct,
        CreatedAt = m.CreatedAt,
        CreatedBy = m.CreatedBy,
        ModifiedAt = m.ModifiedAt,
        ModifiedBy = m.ModifiedBy,
    };

    public static DashboardActualHarvestResponse ToResponse(this DashboardActualHarvest h) => new()
    {
        Id = h.Id,
        TradeUnitKey = h.TradeUnitKey,
        CropCategory = h.CropCategory,
        PlantingYear = h.PlantingYear,
        Bushels = h.Bushels,
        CreatedAt = h.CreatedAt,
        CreatedBy = h.CreatedBy,
        ModifiedAt = h.ModifiedAt,
        ModifiedBy = h.ModifiedBy,
    };
}
