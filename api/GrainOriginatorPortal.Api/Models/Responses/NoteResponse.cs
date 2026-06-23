namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a customer note. Entity-shaped (Decision 1) minus the JSON-ignored
/// Customer navigation; includes the entity's computed Content alias and resolves CreatedBy/
/// ModifiedBy to display names.</summary>
public record NoteResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public string? CustomerCode { get; init; }
    public string? TradeUnit { get; init; }
    public string Description { get; init; } = string.Empty;
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }
    public bool IsPinned { get; init; }
    public bool IsDeleted { get; init; }
    public DateTime? DeletedAt { get; init; }
    public string? DeletedBy { get; init; }
    public string Content { get; init; } = string.Empty;
}
