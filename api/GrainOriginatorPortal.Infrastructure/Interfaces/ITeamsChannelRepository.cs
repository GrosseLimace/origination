using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Registry of @-mentionable Microsoft Teams channels. No visibility filter anywhere: a
/// registered channel is mentionable by everyone, which is what lets one person's pick serve the
/// whole team.</summary>
public interface ITeamsChannelRepository
{
    Task<List<TeamsChannel>> GetAllAsync(CancellationToken cancellationToken);

    Task<TeamsChannel?> GetByIdAsync(int id, CancellationToken cancellationToken);

    /// <summary>Returns the existing row for this channel, or creates it. Concurrent first-picks of
    /// the same channel must converge on one row rather than racing.</summary>
    Task<TeamsChannel> RegisterAsync(TeamsChannel channel, CancellationToken cancellationToken);
}
