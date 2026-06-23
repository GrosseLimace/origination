using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the producer-details domain.</summary>
public static class ProducerDetailsMappings
{
    public static ProducerDetailsResponse ToResponse(this ProducerDetails p, IReadOnlyDictionary<string, string> nameMap) => new()
    {
        Id = p.Id,
        CustomerId = p.CustomerId,
        ScoularId = p.ScoularId,
        CustomerName = p.CustomerName,
        TotalAcres = p.TotalAcres,
        BinCapacity = p.BinCapacity,
        PrimaryContact = p.PrimaryContact,
        Commodities = p.Commodities,
        LinkedProducerIds = p.LinkedProducerIds,
        CreatedBy = DisplayNames.Apply(p.CreatedBy, nameMap),
        CreatedAt = p.CreatedAt,
        ModifiedBy = string.IsNullOrEmpty(p.ModifiedBy) ? p.ModifiedBy : DisplayNames.Apply(p.ModifiedBy, nameMap),
        ModifiedAt = p.ModifiedAt,
    };
}
