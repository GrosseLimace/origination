using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the saved-list domain.</summary>
public static class SavedListMappings
{
    public static SavedListResponse ToResponse(this SavedList l, IReadOnlyDictionary<string, string> nameMap) => new()
    {
        Id = l.Id,
        Name = l.Name,
        Query = l.Query,
        TradeUnits = l.TradeUnits,
        Filters = l.Filters,
        IncludedCustomerIds = l.IncludedCustomerIds,
        ExcludedCustomerIds = l.ExcludedCustomerIds,
        CreatedBy = DisplayNames.Apply(l.CreatedBy, nameMap),
        CreatedAt = l.CreatedAt,
        ModifiedAt = l.ModifiedAt,
        ModifiedBy = string.IsNullOrEmpty(l.ModifiedBy) ? l.ModifiedBy : DisplayNames.Apply(l.ModifiedBy, nameMap),
        IsActive = l.IsActive,
    };
}
