using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for a user's saved trade-unit / group preferences (dbo.UserPreferences),
/// keyed by the short user id. The selections are stored as JSON-array strings; (de)serialization
/// is the caller's concern.</summary>
public interface IUserPreferenceRepository
{
    Task<UserPreference?> GetByUserAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Upserts the user's selections (already JSON-serialized).</summary>
    Task SetAsync(string userId, string selectedGroupNamesJson, string selectedTradeUnitsJson, CancellationToken cancellationToken);
}
