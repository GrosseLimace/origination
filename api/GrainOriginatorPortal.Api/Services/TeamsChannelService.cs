using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class TeamsChannelService : ITeamsChannelService
{
    private readonly ITeamsChannelRepository _repository;
    private readonly IRequestContextService _requestContext;

    public TeamsChannelService(ITeamsChannelRepository repository, IRequestContextService requestContext)
    {
        _repository = repository;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<List<TeamsChannelDto>> GetAllAsync(CancellationToken cancellationToken) =>
        (await _repository.GetAllAsync(cancellationToken)).Select(Map).ToList();

    /// <inheritdoc />
    public async Task<TeamsChannelDto> RegisterAsync(RegisterTeamsChannelRequest request, CancellationToken cancellationToken)
    {
        // Belt and braces: model validation already ran this, but this service is the boundary that
        // decides what becomes a send target, so it refuses to persist an address it hasn't checked
        // itself. Anything that skipped model binding still cannot register a foreign channel.
        if (!TeamsChannelAddress.IsScoularChannel(request.ChannelEmail))
        {
            throw new ValidationException(nameof(request.ChannelEmail),
                "That is not a Scoular Teams channel address.");
        }

        var registered = await _repository.RegisterAsync(new TeamsChannel
        {
            TeamId = request.TeamId.Trim(),
            TeamName = request.TeamName.Trim(),
            ChannelId = request.ChannelId.Trim(),
            DisplayName = request.DisplayName.Trim(),
            ChannelEmail = request.ChannelEmail.Trim(),
            CreatedBy = _requestContext.GetCurrentUser(),
            CreatedAt = DateTime.UtcNow,
        }, cancellationToken);

        return Map(registered);
    }

    private static TeamsChannelDto Map(TeamsChannel c) => new()
    {
        Id = c.Id,
        DisplayName = c.DisplayName,
        TeamName = c.TeamName,
        ChannelId = c.ChannelId,
    };
}
