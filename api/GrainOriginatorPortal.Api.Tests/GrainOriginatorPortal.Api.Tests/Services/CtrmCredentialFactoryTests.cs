// Microsoft namespaces
using Microsoft.Extensions.Configuration;

// Third-party namespaces
using Azure.Identity;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Which credential the CTRM GraphQL client is built with. The managed identity replaces the shared
/// client secret in Azure and a laptop calls as the developer, so these pin that the switch is per
/// environment, that a laptop never reads the secret, and that turning the switch off on App Service
/// falls back to the secret unchanged.
/// </summary>
public class CtrmCredentialFactoryTests
{
    private static IConfiguration Config(bool? useManagedIdentity, bool withSecret)
    {
        var values = new Dictionary<string, string?>();
        if (useManagedIdentity is not null)
            values[CtrmCredentialFactory.UseManagedIdentityKey] = useManagedIdentity.Value.ToString();
        if (withSecret)
        {
            values["Ctrm:TenantId"] = "1521f999-f722-4a4f-9747-166f93e9b0d1";
            values["Ctrm:ClientId"] = "5e9cb280-b006-4705-9ecf-4bbf9d1c7085";
            values["Ctrm:ClientSecret"] = "test-secret";
        }
        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    [Fact]
    public void OnAppService_WithTheSwitchOn_UsesTheManagedIdentity_EvenWhenASecretIsPresent()
    {
        var (credential, kind) = CtrmCredentialFactory.Create(Config(useManagedIdentity: true, withSecret: true), isAppService: true);

        Assert.Equal(CtrmCredentialKind.ManagedIdentity, kind);
        Assert.IsType<ManagedIdentityCredential>(credential);
    }

    [Fact]
    public void OnAppService_WithTheSwitchOn_NeedsNoSecret()
    {
        var (credential, kind) = CtrmCredentialFactory.Create(Config(useManagedIdentity: true, withSecret: false), isAppService: true);

        Assert.Equal(CtrmCredentialKind.ManagedIdentity, kind);
        Assert.NotNull(credential);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public void OnAppService_WithTheSwitchOffOrMissing_UsesTheSecret(bool? useManagedIdentity)
    {
        var (credential, kind) = CtrmCredentialFactory.Create(Config(useManagedIdentity, withSecret: true), isAppService: true);

        Assert.Equal(CtrmCredentialKind.ClientSecret, kind);
        Assert.IsType<ClientSecretCredential>(credential);
    }

    [Fact]
    public void OnAppService_WithTheSwitchOffAndNoSecret_NothingIsConfigured()
    {
        var (credential, kind) = CtrmCredentialFactory.Create(Config(useManagedIdentity: false, withSecret: false), isAppService: true);

        Assert.Equal(CtrmCredentialKind.None, kind);
        Assert.Null(credential);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, true)]
    [InlineData(null, false)]
    public void OffAppService_AlwaysUsesTheDevelopersOwnSignIn_AndNeverTheSecret(bool? useManagedIdentity, bool withSecret)
    {
        // A laptop has no managed identity, and the secret it used to borrow from the Dev Key Vault is
        // being retired — a secret in config must not pull a laptop back onto it.
        var (credential, kind) = CtrmCredentialFactory.Create(Config(useManagedIdentity, withSecret), isAppService: false);

        Assert.Equal(CtrmCredentialKind.DeveloperSignIn, kind);
        Assert.IsType<AzureCliCredential>(credential);
    }
}
