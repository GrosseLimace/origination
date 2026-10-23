using Azure.Core;
using Azure.Identity;

namespace GrainOriginatorPortal.Api.Services.Ctrm;

/// <summary>How the CTRM GraphQL client authenticates, as chosen at startup.</summary>
public enum CtrmCredentialKind
{
    /// <summary>Nothing usable configured — the client reports NotConfigured and sends no request.</summary>
    None,

    /// <summary>The App Service's system-assigned managed identity, holding app roles on the CTRM API.</summary>
    ManagedIdentity,

    /// <summary>Client credentials against the scoular-graphql-client registration, secret from Key Vault.</summary>
    ClientSecret
}

/// <summary>
/// Picks the credential the CTRM GraphQL client requests its tokens with.
/// </summary>
/// <remarks>
/// The App Service managed identities hold the same two roles on scoular-graphql-api
/// (Db2.Read.All, Customers.Read.All) as the client-secret registrations, granted 2026-10-22, so the
/// managed identity replaces the shared secret in Azure. <c>Ctrm:UseManagedIdentity</c> switches it
/// on per environment; the secret path stays so the switch can be rolled back with the App Service
/// setting <c>Ctrm__UseManagedIdentity=false</c> while <c>Ctrm--ClientSecret</c> is still in Key Vault.
/// Off App Service there is no managed identity, so a laptop always uses the secret from user-secrets
/// whatever the flag says.
/// </remarks>
public static class CtrmCredentialFactory
{
    public const string UseManagedIdentityKey = "Ctrm:UseManagedIdentity";

    public static (TokenCredential? Credential, CtrmCredentialKind Kind) Create(IConfiguration configuration, bool isAppService)
    {
        if (isAppService && configuration.GetValue<bool>(UseManagedIdentityKey))
            return (new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned), CtrmCredentialKind.ManagedIdentity);

        var tenantId = configuration.GetValue<string>("Ctrm:TenantId")?.Trim();
        var clientId = configuration.GetValue<string>("Ctrm:ClientId")?.Trim();
        var clientSecret = configuration.GetValue<string>("Ctrm:ClientSecret")?.Trim();

        return !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(clientId) && !string.IsNullOrEmpty(clientSecret)
            ? (new ClientSecretCredential(tenantId, clientId, clientSecret), CtrmCredentialKind.ClientSecret)
            : (null, CtrmCredentialKind.None);
    }
}
