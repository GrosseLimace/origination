using System.Text.Json;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class UserPreferenceService : IUserPreferenceService
{
    private readonly IUserPreferenceRepository _repository;
    private readonly IRequestContextService _requestContext;

    public UserPreferenceService(IUserPreferenceRepository repository, IRequestContextService requestContext)
    {
        _repository = repository;
        _requestContext = requestContext;
    }

    /// <inheritdoc />
    public async Task<UserPreferenceDto> GetAsync(CancellationToken cancellationToken)
    {
        var pref = await _repository.GetByUserAsync(_requestContext.GetCurrentUserShortName(), cancellationToken);
        if (pref is null) return new UserPreferenceDto();

        return new UserPreferenceDto
        {
            SelectedGroupNames = JsonSerializer.Deserialize<string[]>(pref.SelectedGroupNames) ?? [],
            SelectedTradeUnits = JsonSerializer.Deserialize<string[]>(pref.SelectedTradeUnits) ?? []
        };
    }

    /// <inheritdoc />
    public Task SetAsync(UserPreferenceDto dto, CancellationToken cancellationToken) =>
        _repository.SetAsync(
            _requestContext.GetCurrentUserShortName(),
            JsonSerializer.Serialize(dto.SelectedGroupNames ?? []),
            JsonSerializer.Serialize(dto.SelectedTradeUnits ?? []),
            cancellationToken);
}
