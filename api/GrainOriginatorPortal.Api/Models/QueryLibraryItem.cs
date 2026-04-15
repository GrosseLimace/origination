namespace GrainOriginatorPortal.Api.Models;

public class QueryLibraryItem
{
    public int Id { get; set; }
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string QueryText { get; set; } = string.Empty;
    public string? Tags { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? ModifiedAt { get; set; }
}
