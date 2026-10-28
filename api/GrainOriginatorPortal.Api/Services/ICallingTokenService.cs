// Third-party namespaces
using Azure.Communication.Identity;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Why a calling-token exchange did or did not produce a token.</summary>
public enum CallingTokenOutcome
{
    /// <summary>Calling is not configured in this environment (no <c>Acs:Endpoint</c> / <c>Acs:TeamsClientId</c>).
    /// The client treats this as "feature off" and never loads the calling SDK.</summary>
    Unavailable,
    /// <summary>The request carried no Entra token, or the caller's API token carries no object id.</summary>
    InvalidRequest,
    /// <summary>ACS issued a calling token for the caller.</summary>
    Issued,
    /// <summary>ACS refused or the exchange failed (wrong client id, token issued to another user,
    /// missing role, no Teams licence, network). Status is ACS's HTTP status when it answered.</summary>
    ExchangeFailed,
}

/// <summary>Result of <see cref="ICallingTokenService.ExchangeAsync"/>.</summary>
public sealed record CallingTokenResult(
    CallingTokenOutcome Outcome,
    CallingTokenResponse? Token = null,
    int? AcsStatus = null);

/// <summary>
/// Exchanges the browser's Entra token for the Azure Communication Services scopes into an ACS
/// calling token for the signed-in user. See <see cref="CallingTokenService"/>.
/// </summary>
public interface ICallingTokenService
{
    /// <summary>
    /// Exchanges <paramref name="teamsUserAadToken"/> (the Entra token the SPA acquired for the ACS
    /// <c>Teams.ManageCalls</c> / <c>Teams.ManageChats</c> scopes) for a calling token bound to the
    /// CALLER, whose object id is read from their validated API token. Never throws.
    /// </summary>
    Task<CallingTokenResult> ExchangeAsync(string? teamsUserAadToken, CancellationToken cancellationToken);
}

/// <summary>
/// Supplies the ACS Identity client for a resource endpoint. Exists so the service can be tested with
/// a mocked <see cref="CommunicationIdentityClient"/> (its methods are virtual) and so the credential
/// choice (managed identity on App Service, the developer's own credential locally) lives in one place.
/// </summary>
public interface ICommunicationIdentityClientFactory
{
    CommunicationIdentityClient Create(Uri endpoint);
}
