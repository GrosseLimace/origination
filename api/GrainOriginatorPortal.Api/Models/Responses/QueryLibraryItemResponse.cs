namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Wire shape for a query-library item. Entity-shaped for now (matches QueryLibraryItem
/// property-for-property) so the SPA contract is unchanged; reshape only when a real need arises.
/// </summary>
public record QueryLibraryItemResponse
{
    public int Id { get; init; }
    public string Category { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Description { get; init; }
    public string QueryText { get; init; } = string.Empty;
    public string? Tags { get; init; }
    public int SortOrder { get; init; }
    public bool IsActive { get; init; } = true;
    public DateTime CreatedAt { get; init; }
    public DateTime? ModifiedAt { get; init; }
}
