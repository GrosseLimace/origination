namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

public class UserClickEvent
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;
    public string? SubFeatureCode { get; set; }
    public string? TargetId { get; set; }
    public DateTime Timestamp { get; set; }
}
