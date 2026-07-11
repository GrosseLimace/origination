using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record CreateFieldTagRequest
{
    [Required]
    [StringLength(10)]
    public required string SelectionMethod { get; init; }

    [Required]
    public required string GeometryJson { get; init; }

    public decimal? CalcAcres { get; init; }

    [Required]
    [StringLength(80)]
    public required string ExternalRef { get; init; }

    [StringLength(4)]
    public string? CdlYear { get; init; }

    public string? CdlSnapshotJson { get; init; }
}
