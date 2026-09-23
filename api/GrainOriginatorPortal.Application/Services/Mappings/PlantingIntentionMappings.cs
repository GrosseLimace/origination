using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the planting-intention domain.</summary>
public static class PlantingIntentionMappings
{
    public static PlantingIntentionResponse ToResponse(this PlantingIntention p, IReadOnlyDictionary<string, string> nameMap) => new()
    {
        Id = p.Id,
        CustomerId = p.CustomerId,
        CustomerName = p.CustomerName,
        CustomerCode = p.CustomerCode,
        TradeUnit = p.TradeUnit,
        PlantingYear = p.PlantingYear,
        Crop = p.Crop,
        Category = p.Category,
        Type = p.Type,
        Description = p.Description,
        Acres = p.Acres,
        CreatedAt = p.CreatedAt,
        CreatedBy = DisplayNames.Apply(p.CreatedBy, nameMap),
        ModifiedAt = p.ModifiedAt,
        ModifiedBy = string.IsNullOrEmpty(p.ModifiedBy) ? p.ModifiedBy : DisplayNames.Apply(p.ModifiedBy, nameMap),
    };
}
