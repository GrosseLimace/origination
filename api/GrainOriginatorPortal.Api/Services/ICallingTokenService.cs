// Third-party namespaces
using Azure.Communication.Identity;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Mints the Azure Communication Services token that lets the browser act as the signed-in
/// user's own Teams Phone endpoint. See <see cref="CallingTokenService"/> for the exchange.
/// </summary>
public interface ICallingTokenService
{
    /// <summary>
    /// A calling token for the CALLER, or null when the feature is unavailable in this environment
    /// (no ACS resource configured, consent not granted, or the exchange failed). Never throws.
    /// </summary>
    Task<CallingTokenResponse?> GetTokenForCallerAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Builds the ACS Identity client for a resource endpoint. Exists so the service can be tested with
/// a mocked <see cref="CommunicationIdentityClient"/> (its methods are virtual) and so the
/// credential choice (managed identity on App Service, developer credential locally) stays in one
/// place in Program.cs.
/// </summary>
public interface ICommunicationIdentityClientFactory
{
    CommunicationIdentityClient Create(Uri endpoint);
}
