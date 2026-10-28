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
    // DefaultAzureCredential without the IMDS probe locally (it times out off Azure).
    private static readonly TokenCredential Credential =
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"))
            ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
            : new DefaultAzureCredential(new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true });

    /// <inheritdoc />
    public CommunicationIdentityClient Create(Uri endpoint) => new(endpoint, Credential);
}
