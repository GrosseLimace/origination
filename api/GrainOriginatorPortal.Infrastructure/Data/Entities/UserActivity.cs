namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class UserActivity
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string HttpMethod { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public int StatusCode { get; set; }
    public int DurationMs { get; set; }
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public DateTime Timestamp { get; set; }
}
