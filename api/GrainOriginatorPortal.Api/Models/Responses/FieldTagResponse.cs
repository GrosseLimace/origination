namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a customer field tag. Entity-shaped, per docs/maps/field-tagging/02-backend-api.md.</summary>
public record FieldTagResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string SelectionMethod { get; init; } = string.Empty;
    public string GeometryJson { get; init; } = string.Empty;
    public decimal? CalcAcres { get; init; }
    public string ExternalRef { get; init; } = string.Empty;
    public string? CdlYear { get; init; }
    public string? CdlSnapshotJson { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
