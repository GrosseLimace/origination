using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the field-tagging POC domain.</summary>
public static class FieldTagMappings
{
    public static FieldTagResponse ToResponse(this CustomerFieldTag t) => new()
    {
        Id = t.Id,
        CustomerId = t.CustomerId,
        SelectionMethod = t.SelectionMethod,
        GeometryJson = t.GeometryJson,
        CalcAcres = t.CalcAcres,
        ExternalRef = t.ExternalRef,
        CdlYear = t.CdlYear,
        CdlSnapshotJson = t.CdlSnapshotJson,
        CreatedBy = t.CreatedBy,
        CreatedAt = t.CreatedAt,
        ModifiedBy = t.ModifiedBy,
        ModifiedAt = t.ModifiedAt,
    };
}
