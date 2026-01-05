namespace GrainOriginatorPortal.Models;

public class SavedList
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Query { get; set; } = string.Empty;
    public List<string> CustomerIds { get; set; } = new();
    public DateTime CreatedAt { get; set; }
}
