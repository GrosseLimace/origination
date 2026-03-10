using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateFarmRequest
{
    [Required]
    [StringLength(200)]
    public required string Name { get; init; }

    [Required]
    [StringLength(200)]
    public required string Location { get; init; }

    [Range(1, 100000)]
    public int Acres { get; init; }
}
