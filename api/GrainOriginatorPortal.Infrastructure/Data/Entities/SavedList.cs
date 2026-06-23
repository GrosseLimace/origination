namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Represents a saved customer list created via the list builder.
/// Only the query prompt is stored; customer IDs are computed dynamically at runtime.
/// </summary>
public class SavedList
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Query { get; set; } = string.Empty;
    public string? TradeUnits { get; set; } // Comma-separated trade unit keys (e.g. "TU1,TU2")
    public string? Filters { get; set; }   // JSON-serialized RefinementFilters (nullable)
    public string? IncludedCustomerIds { get; set; }  // JSON array of manually added customer IDs
    public string? ExcludedCustomerIds { get; set; }  // JSON array of manually removed customer IDs
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? ModifiedAt { get; set; }
    public string? ModifiedBy { get; set; }
    public bool IsActive { get; set; } = true;
}
