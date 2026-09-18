namespace GrainOriginatorPortal.Api.Models;

/// <summary>A registered, @-mentionable Teams channel.
/// <para>Deliberately carries NO address: the client only ever needs the id to build a mention, and
/// the note stores only that id. Returning the address would put a send target in the browser for no
/// reason.</para></summary>
public record TeamsChannelDto
{
    public int Id { get; init; }
    public string DisplayName { get; init; } = string.Empty;
    public string TeamName { get; init; } = string.Empty;
    public string ChannelId { get; init; } = string.Empty;
}
