// Third-party namespaces
using Azure;
using Azure.Communication.Identity;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Turns the browser's Entra token for Azure Communication Services into an ACS calling token for
/// THE SIGNED-IN USER'S OWN Teams identity ("Communication as a Microsoft 365 user"). With it, the
/// browser's ACS Calling SDK registers the Workbench tab as one of the user's Teams Phone endpoints,
/// so a producer calling their number rings the tab too and the SDK reports the caller id at ring time.
/// <para>
/// The design follows Infrastructure's guide (docs/application-context/TEAMS-CALLING-GUIDE.md):
/// <list type="number">
/// <item>The SPA acquires an Entra token for the ACS scopes with its own MSAL session. Admin consent
/// for those scopes lives on the SPA registration, so no user ever sees a consent prompt.</item>
/// <item>The SPA posts that token here. This service hands it to the ACS Identity SDK
/// (<c>GetTokenForTeamsUser</c>), authenticated as the App Service managed identity, which holds
/// "Communication and Email Service Owner" on the ACS resource. No key or secret anywhere; the resource
/// has local authentication disabled.</item>
/// </list>
/// </para>
/// <para>
/// The boundary: the user's object id comes from their VALIDATED API token, never from the request,
/// and ACS rejects the exchange unless the Entra token was issued to that same user and to the
/// configured SPA client id. So a caller can only ever mint a calling token for themselves. Tokens
/// are not cached server-side (the SDK refreshes on demand) and are never logged.
/// </para>
/// <para>Nothing in here throws: a missing configuration, a bad request or an ACS failure all come
/// back as an outcome the controller maps to a status code.</para>
/// </summary>
public class CallingTokenService : ICallingTokenService
{
    private readonly IRequestContextService _requestContext;
    private readonly ICommunicationIdentityClientFactory _clientFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<CallingTokenService> _logger;

    public CallingTokenService(
        IRequestContextService requestContext,
        ICommunicationIdentityClientFactory clientFactory,
        IConfiguration config,
        ILogger<CallingTokenService> logger)
    {
        _requestContext = requestContext;
        _clientFactory = clientFactory;
        _config = config;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<CallingTokenResult> ExchangeAsync(string? teamsUserAadToken, CancellationToken cancellationToken)
    {
        var endpoint = _config["Acs:Endpoint"];
        var teamsClientId = _config["Acs:TeamsClientId"];
        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(teamsClientId))
            return new CallingTokenResult(CallingTokenOutcome.Unavailable); // Feature off here. Expected; not worth a log line per call.

        if (string.IsNullOrWhiteSpace(teamsUserAadToken))
            return new CallingTokenResult(CallingTokenOutcome.InvalidRequest);

        var objectId = _requestContext.GetCurrentUserObjectId();
        if (string.IsNullOrWhiteSpace(objectId))
        {
            _logger.LogWarning("Calling token refused: the caller's API token carries no object id");
            return new CallingTokenResult(CallingTokenOutcome.InvalidRequest);
        }

        try
        {
            var client = _clientFactory.Create(new Uri(endpoint));
            // clientId = the SPA registration that requested the Entra token (its `appid`), NOT this API's.
            var options = new GetTokenForTeamsUserOptions(teamsUserAadToken, teamsClientId, objectId);
            var response = await client.GetTokenForTeamsUserAsync(options, cancellationToken);
            return new CallingTokenResult(CallingTokenOutcome.Issued, new CallingTokenResponse
            {
                Token = response.Value.Token,
                ExpiresOn = response.Value.ExpiresOn,
            });
        }
        catch (RequestFailedException ex)
        {
            // ACS said no: wrong endpoint, the identity lacks the role, clientId does not match the
            // token's appid, the token belongs to another user, or no Teams licence. The status and
            // error code alone proved too terse to tell these apart ("401 Denied" for all of them in
            // the Dev POC), so ACS's own error text is logged too. It describes the rule that failed and
            // never echoes either token; the response headers (which can) are cut off.
            _logger.LogWarning(
                "Calling token exchange failed: ACS answered {Status} {ErrorCode}: {Detail}",
                ex.Status, ex.ErrorCode, AcsErrorDetail(ex));
            return new CallingTokenResult(CallingTokenOutcome.ExchangeFailed, AcsStatus: ex.Status);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Calling token exchange failed before ACS answered");
            return new CallingTokenResult(CallingTokenOutcome.ExchangeFailed);
        }
    }

    /// <summary>The ACS error body from a failed request — the part of the SDK message before the
    /// response headers — flattened to one line and capped, so it fits a log entry without carrying
    /// anything from the headers.</summary>
    internal static string AcsErrorDetail(RequestFailedException ex)
    {
        var text = ex.Message.Split("Headers:", 2)[0];
        var oneLine = string.Join(' ', text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()));
        return oneLine.Length <= 400 ? oneLine : oneLine[..400] + "…";
    }
}
