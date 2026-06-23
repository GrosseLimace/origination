namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for user-entered producer details. Entity-shaped (Decision 1) minus the
/// JSON-ignored Customer navigation; CreatedBy/ModifiedBy are resolved to display names.</summary>
public record ProducerDetailsResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string? ScoularId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal? TotalAcres { get; init; }
    public decimal? BinCapacity { get; init; }
    public string? PrimaryContact { get; init; }
    public string? Commodities { get; init; }
    public string? LinkedProducerIds { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
