using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services.Mappings;

/// <summary>Manual entity → response mappings for the farm domain.</summary>
public static class FarmMappings
{
    public static FarmResponse ToResponse(this Farm f) => new()
    {
        Id = f.Id,
        Name = f.Name,
        Location = f.Location,
        Acres = f.Acres,
        BinStorageCapacity = f.BinStorageCapacity,
    };
}
