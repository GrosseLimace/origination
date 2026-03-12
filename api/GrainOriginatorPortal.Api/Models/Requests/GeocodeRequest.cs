using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record GeocodeRequest
{
    [Required]
    [StringLength(200)]
    public string Key { get; init; } = string.Empty;

    [StringLength(300)]
    public string? Street { get; init; }

    [StringLength(100)]
    public string? City { get; init; }

    [StringLength(50)]
    public string? State { get; init; }

    [StringLength(20)]
    public string? Zip { get; init; }
}
