namespace GrainOriginatorPortal.Models;

/// <summary>
/// Represents a saved customer list created via the list builder.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data:
/// - Store in user-specific preferences
/// - Add sharing capability between users
/// - Consider storing the filter criteria separately for dynamic updates
/// </remarks>
public class SavedList
{
    /// <summary>
    /// Unique identifier for the saved list.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// User-defined name for the list.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// The natural language query used to generate this list.
    /// </summary>
    /// <remarks>TODO: Consider storing structured filter criteria for re-execution</remarks>
    public string Query { get; set; } = string.Empty;

    /// <summary>
    /// List of customer IDs included in this saved list.
    /// </summary>
    public List<string> CustomerIds { get; set; } = new();

    /// <summary>
    /// When the list was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }
}
