using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Registry of @-mentionable Microsoft Teams channels.</summary>
public interface ITeamsChannelService
{
    /// <summary>Every registered channel. Unfiltered on purpose — a channel registered by one person
    /// is mentionable by everyone, which is what makes the first pick serve the whole team.</summary>
    Task<List<TeamsChannelDto>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Registers a channel the caller picked in the composer, or returns the existing row.</summary>
    Task<TeamsChannelDto> RegisterAsync(RegisterTeamsChannelRequest request, CancellationToken cancellationToken);
}
