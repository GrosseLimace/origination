namespace GrainOriginatorPortal.Api.Models;

/// <summary>A Teams channel the calling user can post to, as read from Microsoft Graph.
/// <para>Carries the channel address because the composer must hand it back when registering the
/// channel for the first time. It is not stored on a note — the registry keeps it, and the workflow
/// re-reads it at send time.</para></summary>
public record UserTeamsChannel
{
    public string TeamId { get; init; } = string.Empty;
    public string TeamName { get; init; } = string.Empty;
    public string ChannelId { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public string ChannelEmail { get; init; } = string.Empty;
}
