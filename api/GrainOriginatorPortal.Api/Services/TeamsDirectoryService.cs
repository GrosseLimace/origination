using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

using Microsoft.Extensions.Caching.Memory;
using Microsoft.Identity.Web;

using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Lists the Teams channels the calling user belongs to, using Microsoft Graph <b>on-behalf-of</b>
/// that user.
/// <para>
/// This used to run in the browser with the SPA's own token. IT Security moved it here on
/// 2026-09-15: delegated Graph permissions belong on the API registration, because their app
/// registrations are rebuilt from a config template and a permission added by hand to a SPA would
/// vanish on the next reconcile. The boundary is unchanged, because the exchange preserves the
/// user's identity, so Graph still only returns teams that person is in.
/// </para>
/// <para>
/// Server-side is also the better place for it: listing channels costs one Graph request PER TEAM,
/// so the fan-out now happens next to Graph instead of across the corporate network, and the result
/// is cacheable per user.
/// </para>
/// </summary>
public class TeamsDirectoryService : ITeamsDirectoryService
{
    /// <summary>Both are required, and it is easy to grant only the second: /me/joinedTeams is gated
    /// by Team.ReadBasic.All, /teams/{id}/channels by Channel.ReadBasic.All. Each is the
    /// least-privileged delegated permission for its endpoint.</summary>
    private static readonly string[] GraphScopes =
        ["Team.ReadBasic.All", "Channel.ReadBasic.All"];

    /// <summary>Short enough that a newly created channel shows up the same morning, long enough
    /// that opening several producers does not re-run the fan-out each time.</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(15);

    /// <summary>A failure is cached too, briefly. Without this, an environment with no consent yet
    /// would re-attempt the whole fan-out on every page load and fail every time.</summary>
    private static readonly TimeSpan FailureCacheTtl = TimeSpan.FromMinutes(2);

    private static readonly JsonSerializerOptions JsonOptions =
        new() { PropertyNameCaseInsensitive = true };

    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IRequestContextService _requestContext;
    private readonly IMemoryCache _cache;
    private readonly ILogger<TeamsDirectoryService> _logger;

    public TeamsDirectoryService(
        ITokenAcquisition tokenAcquisition,
        IHttpClientFactory httpClientFactory,
        IRequestContextService requestContext,
        IMemoryCache cache,
        ILogger<TeamsDirectoryService> logger)
    {
        _tokenAcquisition = tokenAcquisition;
        _httpClientFactory = httpClientFactory;
        _requestContext = requestContext;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<UserTeamsChannel>> GetMyChannelsAsync(CancellationToken cancellationToken)
    {
        // Cache per USER. The answer is that person's team membership, so a shared entry would leak
        // one user's teams to another.
        var cacheKey = $"teams-channels:{_requestContext.GetCurrentUser()}";
        if (_cache.TryGetValue(cacheKey, out List<UserTeamsChannel>? cached) && cached is not null)
            return cached;

        var channels = await LoadAsync(cancellationToken);

        _cache.Set(cacheKey, channels, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = channels.Count > 0 ? CacheTtl : FailureCacheTtl,
        });
        return channels;
    }

    private async Task<List<UserTeamsChannel>> LoadAsync(CancellationToken cancellationToken)
    {
        string token;
        try
        {
            token = await _tokenAcquisition.GetAccessTokenForUserAsync(GraphScopes);
        }
        catch (MicrosoftIdentityWebChallengeUserException ex)
        {
            // Consent for these scopes has not been granted in this environment yet. Expected in QA
            // and Production until IT grants it, so it is information rather than an error.
            _logger.LogInformation(ex,
                "Teams channel lookup unavailable: Graph consent not granted for {Scopes}",
                string.Join(", ", GraphScopes));
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Teams channel lookup unavailable: could not acquire a Graph token on-behalf-of the caller");
            return [];
        }

        var http = _httpClientFactory.CreateClient("graph");
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var teams = await GetAsync<GraphList<GraphTeam>>(http, "me/joinedTeams", cancellationToken);
        if (teams?.Value is not { Count: > 0 } joined) return [];

        // One request per team, in parallel. Channels the user cannot see never come back.
        var perTeam = await Task.WhenAll(joined
            .Where(t => !string.IsNullOrWhiteSpace(t.Id))
            .Select(t => GetChannelsAsync(http, t, cancellationToken)));

        return perTeam.SelectMany(c => c).ToList();
    }

    private async Task<List<UserTeamsChannel>> GetChannelsAsync(
        HttpClient http, GraphTeam team, CancellationToken cancellationToken)
    {
        // $select asks for email explicitly: Graph omits it by default because populating it is
        // expensive, and without it every channel would look like it has no address.
        var url = $"teams/{Uri.EscapeDataString(team.Id!)}/channels?$select=id,displayName,email,membershipType";
        var channels = await GetAsync<GraphList<GraphChannel>>(http, url, cancellationToken);

        return (channels?.Value ?? [])
            // Channels with no email address are dropped. Teams does not create one until somebody
            // picks "Get email address", and we deliberately hold no permission to provision them,
            // so such a channel cannot be posted to and must not be offered.
            .Where(c => !string.IsNullOrWhiteSpace(c.Id) && !string.IsNullOrWhiteSpace(c.Email))
            .Select(c => new UserTeamsChannel
            {
                TeamId = team.Id!,
                TeamName = team.DisplayName ?? string.Empty,
                ChannelId = c.Id!,
                DisplayName = c.DisplayName ?? string.Empty,
                ChannelEmail = c.Email!,
            })
            .ToList();
    }

    /// <summary>One GET, with every failure degraded to null. A single inaccessible team must not
    /// lose the other twenty, and no Graph problem should ever break the mention picker.</summary>
    private async Task<T?> GetAsync<T>(HttpClient http, string url, CancellationToken cancellationToken)
        where T : class
    {
        try
        {
            using var response = await http.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                // A 403 means the app registration is missing one of the two permissions, which is
                // the most likely misconfiguration by far. Name it rather than log a bare code.
                if (response.StatusCode == HttpStatusCode.Forbidden)
                {
                    _logger.LogWarning(
                        "Graph returned 403 for {Url}. The API app registration needs delegated {Scopes} with admin consent.",
                        url, string.Join(" and ", GraphScopes));
                }
                else
                {
                    _logger.LogWarning("Graph returned {Status} for {Url}", (int)response.StatusCode, url);
                }
                return null;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return JsonSerializer.Deserialize<T>(body, JsonOptions);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Graph request failed for {Url}", url);
            return null;
        }
    }

    private sealed class GraphList<T>
    {
        public List<T>? Value { get; set; }
    }

    private sealed class GraphTeam
    {
        public string? Id { get; set; }

        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }
    }

    private sealed class GraphChannel
    {
        public string? Id { get; set; }

        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }

        public string? Email { get; set; }

        [JsonPropertyName("membershipType")]
        public string? MembershipType { get; set; }
    }
}
