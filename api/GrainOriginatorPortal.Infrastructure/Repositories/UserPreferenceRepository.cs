using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class UserPreferenceRepository : IUserPreferenceRepository
{
    private readonly ApplicationDbContext _appContext;

    public UserPreferenceRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public Task<UserPreference?> GetByUserAsync(string userId, CancellationToken cancellationToken) =>
        _appContext.UserPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);

    public async Task SetAsync(string userId, string selectedGroupNamesJson, string selectedTradeUnitsJson, CancellationToken cancellationToken)
    {
        var pref = await _appContext.UserPreferences.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (pref == null)
        {
            pref = new UserPreference { UserId = userId };
            _appContext.UserPreferences.Add(pref);
        }
        pref.SelectedGroupNames = selectedGroupNamesJson;
        pref.SelectedTradeUnits = selectedTradeUnitsJson;
        pref.UpdatedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
