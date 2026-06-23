namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class UserPreference
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;     // UPN before @, e.g. "CEgr"
    public string SelectedGroupNames { get; set; } = "[]"; // JSON array of group name strings
    public string SelectedTradeUnits { get; set; } = "[]"; // JSON array of trade unit code strings
    public DateTime UpdatedAt { get; set; }
}
