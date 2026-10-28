// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Identity.Web;

// Third-party namespaces
using Azure;
using Azure.Communication.Identity;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Turns the caller's API token into an Azure Communication Services token for THEIR OWN Teams
/// identity ("Communication as a Microsoft 365 user"). With it, the browser's ACS Calling SDK
/// registers the Workbench tab as one of the user's Teams Phone endpoints, so a producer calling
/// their number rings the tab too and the SDK reports the caller id at ring time.
/// <para>
/// Two hops, neither involving a secret:
/// <list type="number">
/// <item>On-behalf-of exchange (same federated-credential + managed-identity setup as
/// <see cref="TeamsDirectoryService"/>) for the ACS scope <c>Teams.ManageCalls</c>.</item>
/// <item>ACS Identity SDK <c>GetTokenForTeamsUser</c>, authenticated as the App Service managed
/// identity (Contributor on the ACS resource), which signs that Entra token into a calling token.</item>
/// </list>
/// </para>
/// <para>
/// Nothing in here throws: a missing <c>Acs:Endpoint</c>, missing consent, or an ACS failure all
/// come back as null, which the controller turns into 204 and the client reads as "feature off".
/// The token is minted for the caller only and is never logged.
/// </para>
/// </summary>
public class CallingTokenService : ICallingTokenService
{
    /// <summary>The one delegated permission this needs, on the "Azure Communication Services"
    /// resource (not Graph). Admin-consented on the API registration like the Graph scopes.</summary>
    internal static readonly string[] AcsScopes =
        ["https://auth.msft.communication.azure.com/Teams.ManageCalls"];

    /// <summary>Hand the client a token with at least this much life left; the SDK refreshes
    /// proactively, so serving one that is about to expire just causes a second round trip.</summary>
    private static readonly TimeSpan ExpiryMargin = TimeSpan.FromMinutes(5);

    private readonly ITokenAcquisition _tokenAcquisition;
    private readonly IRequestContextService _requestContext;
    private readonly ICommunicationIdentityClientFactory _clientFactory;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _config;
    private readonly ILogger<CallingTokenService> _logger;

    public CallingTokenService(
        ITokenAcquisition tokenAcquisition,
        IRequestContextService requestContext,
        ICommunicationIdentityClientFactory clientFactory,
        IMemoryCache cache,
        IConfiguration config,
        ILogger<CallingTokenService> logger)
    {
        _tokenAcquisition = tokenAcquisition;
        _requestContext = requestContext;
        _clientFactory = clientFactory;
        _cache = cache;
        _config = config;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<CallingTokenResponse?> GetTokenForCallerAsync(CancellationToken cancellationToken)
    {
        var endpoint = _config["Acs:Endpoint"];
        if (string.IsNullOrWhiteSpace(endpoint))
            return null; // Feature off in this environment. Expected; not worth a log line per call.

        var objectId = _requestContext.GetCurrentUserObjectId();
        if (string.IsNullOrWhiteSpace(objectId))
        {
            _logger.LogWarning("Calling token unavailable: the caller's token carries no object id");
            return null;
        }

        // Cache per USER: the token IS that person's Teams identity, so a shared entry would let one
        // user's tab ring with another user's calls.
        var cacheKey = $"calling-token:{objectId}";
        if (_cache.TryGetValue(cacheKey, out CallingTokenResponse? cached) && cached is not null)
            return cached;

        var token = await MintAsync(endpoint, objectId, cancellationToken);
        if (token is null)
            return null;

        var ttl = token.ExpiresOn - DateTimeOffset.UtcNow - ExpiryMargin;
        if (ttl > TimeSpan.Zero)
            _cache.Set(cacheKey, token, new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = ttl });

        return token;
    }

    private async Task<CallingTokenResponse?> MintAsync(string endpoint, string objectId, CancellationToken cancellationToken)
    {
        string entraToken;
        try
        {
            entraToken = await _tokenAcquisition.GetAccessTokenForUserAsync(AcsScopes);
        }
        catch (MicrosoftIdentityWebChallengeUserException ex)
        {
            // Consent for the ACS scope has not been granted in this environment yet. Expected until
            // IT grants it, so it is information rather than an error.
            _logger.LogInformation(ex,
                "Calling token unavailable: consent not granted for {Scopes}", string.Join(", ", AcsScopes));
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Calling token unavailable: could not acquire an ACS token on-behalf-of the caller");
            return null;
        }

        var clientId = _config["AzureAd:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId))
        {
            _logger.LogWarning("Calling token unavailable: AzureAd:ClientId is not configured");
            return null;
        }

        try
        {
            var client = _clientFactory.Create(new Uri(endpoint));
            var options = new GetTokenForTeamsUserOptions(entraToken, clientId, objectId);
            var response = await client.GetTokenForTeamsUserAsync(options, cancellationToken);
            return new CallingTokenResponse
            {
                Token = response.Value.Token,
                ExpiresOn = response.Value.ExpiresOn,
            };
        }
        catch (RequestFailedException ex)
        {
            // The ACS side said no: wrong endpoint, the managed identity lacks the role on the
            // resource, or the user has no Teams licence. Status + error code are enough to tell
            // which; the message can carry the user's object id, so it stays out of the log.
            _logger.LogWarning(
                "Calling token unavailable: ACS token exchange failed with {Status} {ErrorCode}",
                ex.Status, ex.ErrorCode);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Calling token unavailable: ACS token exchange failed");
            return null;
        }
    }
}
