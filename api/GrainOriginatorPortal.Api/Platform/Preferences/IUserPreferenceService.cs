using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;


namespace GrainOriginatorPortal.Api.Platform.Preferences;

/// <summary>The current user's saved trade-unit / group selections.</summary>
public interface IUserPreferenceService
{
    Task<UserPreferenceDto> GetAsync(CancellationToken cancellationToken);
    Task SetAsync(UserPreferenceDto dto, CancellationToken cancellationToken);
}
