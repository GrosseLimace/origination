using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Reads the Microsoft Teams channels the CALLING USER belongs to, via Graph on-behalf-of.</summary>
public interface ITeamsDirectoryService
{
    /// <summary>The caller's channels, or an EMPTY list if Graph is unavailable or consent has not
    /// been granted. Never throws: the "@" picker must keep offering people and trade units even
    /// when this source is dark.</summary>
    Task<List<UserTeamsChannel>> GetMyChannelsAsync(CancellationToken cancellationToken);
}
