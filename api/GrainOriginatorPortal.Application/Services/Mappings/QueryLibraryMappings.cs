using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the query-library domain.</summary>
public static class QueryLibraryMappings
{
    public static QueryLibraryItemResponse ToResponse(this QueryLibraryItem item) => new()
    {
        Id = item.Id,
        Category = item.Category,
        Name = item.Name,
        Description = item.Description,
        QueryText = item.QueryText,
        Tags = item.Tags,
        SortOrder = item.SortOrder,
        IsActive = item.IsActive,
        CreatedAt = item.CreatedAt,
        ModifiedAt = item.ModifiedAt,
    };
}
