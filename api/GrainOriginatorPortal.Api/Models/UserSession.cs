namespace GrainOriginatorPortal.Api.Models;

public class UserSession
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateTime LoginTime { get; set; }
    public DateTime LastActivityTime { get; set; }
    public int DurationMinutes { get; set; }
}
