using Azure.Core;
using Azure.Identity;

namespace GrainOriginatorPortal.Api.Platform.Ctrm;

/// <summary>How the CTRM GraphQL client authenticates, as chosen at startup.</summary>
public enum CtrmCredentialKind
{
    /// <summary>Nothing usable configured — the client reports NotConfigured and sends no request.</summary>
    None,

    /// <summary>The App Service's system-assigned managed identity, holding app roles on the CTRM API.</summary>
    ManagedIdentity,

    /// <summary>Client credentials against the scoular-graphql-client registration, secret from Key Vault.</summary>
    ClientSecret,

    /// <summary>Off App Service: the developer's own Azure CLI sign-in (<c>az login</c>).</summary>
    DeveloperSignIn
}

/// <summary>
/// Picks the credential the CTRM GraphQL client requests its tokens with.
/// </summary>
/// <remarks>
/// <para>The App Service managed identities hold the same two roles on scoular-graphql-api
/// (Db2.Read.All, Customers.Read.All) as the client-secret registrations, granted 2026-10-22, so the
/// managed identity replaces the shared secret in Azure. <c>Ctrm:UseManagedIdentity</c> switches it
/// on per environment; the secret path stays so the switch can be rolled back with the App Service
/// setting <c>Ctrm__UseManagedIdentity=false</c> while <c>Ctrm--ClientSecret</c> is still in Key Vault.</para>
/// <para>Off App Service there is no managed identity, so a laptop calls CTRM as the developer: the API
/// pre-authorizes the Azure CLI for its delegated <c>Db2.Read</c> scope (contracts, tickets), and the
/// "Scoular GraphQL API Users" group holds <c>Customers.Read.All</c> (customers; added 2026-10-26). The
/// Ctrm secret is never read locally — before this, laptops borrowed it from the Dev Key Vault.
/// <see cref="AzureCliCredential"/> rather than DefaultAzureCredential: the Visual Studio credentials it
/// tries first use client ids the API does not pre-authorize, and a hard failure there ends the chain.</para>
/// </remarks>
public static class CtrmCredentialFactory
{
    public const string UseManagedIdentityKey = "Ctrm:UseManagedIdentity";

    public static (TokenCredential? Credential, CtrmCredentialKind Kind) Create(IConfiguration configuration, bool isAppService)
    {
        var tenantId = configuration.GetValue<string>("Ctrm:TenantId")?.Trim();

        if (!isAppService)
            return (new AzureCliCredential(new AzureCliCredentialOptions { TenantId = string.IsNullOrEmpty(tenantId) ? null : tenantId }),
                CtrmCredentialKind.DeveloperSignIn);

        if (configuration.GetValue<bool>(UseManagedIdentityKey))
            return (new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned), CtrmCredentialKind.ManagedIdentity);

        var clientId = configuration.GetValue<string>("Ctrm:ClientId")?.Trim();
        var clientSecret = configuration.GetValue<string>("Ctrm:ClientSecret")?.Trim();

        return !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(clientId) && !string.IsNullOrEmpty(clientSecret)
            ? (new ClientSecretCredential(tenantId, clientId, clientSecret), CtrmCredentialKind.ClientSecret)
            : (null, CtrmCredentialKind.None);
    }
}
