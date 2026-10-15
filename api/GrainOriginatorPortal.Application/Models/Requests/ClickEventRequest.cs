namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Inbound payload for POST /api/usage-dashboard/click — a single user interaction event.</summary>
public record ClickEventRequest
{
    public string EventType { get; init; } = string.Empty;
    public string FeatureCode { get; init; } = string.Empty;
    public string? SubFeatureCode { get; init; }
    public string? TargetId { get; init; }
}
