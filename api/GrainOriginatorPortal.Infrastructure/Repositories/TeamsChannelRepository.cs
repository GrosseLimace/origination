using Microsoft.EntityFrameworkCore;

using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <inheritdoc />
public class TeamsChannelRepository : ITeamsChannelRepository
{
    private readonly ApplicationDbContext _appContext;

    public TeamsChannelRepository(ApplicationDbContext appContext) => _appContext = appContext;

    public Task<List<TeamsChannel>> GetAllAsync(CancellationToken cancellationToken) =>
        _appContext.TeamsChannels.AsNoTracking()
            .OrderBy(c => c.DisplayName)
            .ToListAsync(cancellationToken);

    public Task<TeamsChannel?> GetByIdAsync(int id, CancellationToken cancellationToken) =>
        _appContext.TeamsChannels.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);

    public async Task<TeamsChannel> RegisterAsync(TeamsChannel channel, CancellationToken cancellationToken)
    {
        var existing = await _appContext.TeamsChannels
            .FirstOrDefaultAsync(c => c.ChannelId == channel.ChannelId, cancellationToken);

        if (existing != null)
        {
            // Keep the display fields current — channels get renamed, and a stale label in the
            // picker is how someone mentions the wrong channel. The address is refreshed too: only
            // an already-validated address reaches here.
            existing.TeamName = channel.TeamName;
            existing.DisplayName = channel.DisplayName;
            existing.ChannelEmail = channel.ChannelEmail;
            await _appContext.SaveChangesAsync(cancellationToken);
            return existing;
        }

        _appContext.TeamsChannels.Add(channel);
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
            return channel;
        }
        catch (DbUpdateException)
        {
            // Lost the race against another first-pick of the same channel. The unique index is the
            // arbiter; re-read rather than surfacing a 500 for what is a successful outcome. If the
            // re-read finds nothing the failure was something else, so let the original propagate.
            _appContext.Entry(channel).State = EntityState.Detached;
            var winner = await _appContext.TeamsChannels.AsNoTracking()
                .FirstOrDefaultAsync(c => c.ChannelId == channel.ChannelId, cancellationToken);
            if (winner == null) throw;
            return winner;
        }
    }
}
