// System namespaces
using System.Collections.Concurrent;

// Third-party namespaces
using Azure.Communication.Identity;
using Azure.Core;
using Azure.Identity;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class CommunicationIdentityClientFactory : ICommunicationIdentityClientFactory
{
    // Same credential split as the Key Vault bootstrap and GraphDirectoryClient in Program.cs:
    // ManagedIdentityCredential directly on App Service (no DefaultAzureCredential probe chain),
    // DefaultAzureCredential without the IMDS probe locally — that still resolves to the developer's
    // `az login`, which is what Infrastructure's guide relies on (the Developer Admins group holds the
    // ACS role), it just skips the managed-identity probe that times out off Azure.
    private static readonly TokenCredential Credential =
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"))
            ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
            : new DefaultAzureCredential(new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true });

    // One client per endpoint for the process lifetime (the guide registers the client as a
    // singleton); the factory shape only exists so tests can substitute a mock.
    private readonly ConcurrentDictionary<string, CommunicationIdentityClient> _clients = new();

    /// <inheritdoc />
    public CommunicationIdentityClient Create(Uri endpoint) =>
        _clients.GetOrAdd(endpoint.AbsoluteUri, _ => new CommunicationIdentityClient(endpoint, Credential));
}
