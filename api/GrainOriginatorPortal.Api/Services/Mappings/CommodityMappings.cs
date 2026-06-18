using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the commodity domain.</summary>
public static class CommodityMappings
{
    public static CommodityResponse ToResponse(this Commodity c) => new()
    {
        Id = c.Id,
        Code = c.Code,
        Name = c.Name,
        Category = c.Category,
        Tier1 = c.Tier1,
        Tier2 = c.Tier2,
        Tier3 = c.Tier3,
        BaseUOM = c.BaseUOM,
        IsActive = c.IsActive,
        ShowInPlantingIntentions = c.ShowInPlantingIntentions,
    };

    public static CommodityConversionResponse ToResponse(this CommodityConversion c) => new()
    {
        CommodityCode = c.CommodityCode,
        Description = c.Description,
        LbsPerUnit = c.LbsPerUnit,
        UnitOfMeasure = c.UnitOfMeasure,
    };

    public static HarvestWindowResponse ToResponse(this HarvestWindow h) => new()
    {
        Id = h.Id,
        Commodity = h.Commodity,
        DeliveryStartMonth = h.DeliveryStartMonth,
        DeliveryStartDay = h.DeliveryStartDay,
        DeliveryEndMonth = h.DeliveryEndMonth,
        DeliveryEndDay = h.DeliveryEndDay,
        IsActive = h.IsActive,
    };
}
