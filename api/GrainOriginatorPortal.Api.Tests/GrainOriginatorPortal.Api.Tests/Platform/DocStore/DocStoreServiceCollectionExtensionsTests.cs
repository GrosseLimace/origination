// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.DocStore;

namespace GrainOriginatorPortal.Api.Tests.Platform.DocStore;

/// <summary>Which Doc Store client <see cref="DocStoreServiceCollectionExtensions.AddDocStore"/> registers for each mode.</summary>
public class DocStoreServiceCollectionExtensionsTests
{
    private static IConfiguration Config(params (string Key, string Value)[] settings) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();

    private static IHostEnvironment Environment(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    private static Type? Registered(IServiceCollection services) =>
        services.Single(d => d.ServiceType == typeof(IDocStoreClient)).ImplementationType;

    [Fact]
    public void DocStore_IsOff_UntilConfigured()
    {
        var services = new ServiceCollection().AddDocStore(Config(), Environment(Environments.Production));

        Assert.Equal(typeof(DisabledDocStoreClient), Registered(services));
    }

    [Fact]
    public void DocStore_HttpWithoutBaseUrlAndScope_StaysOff()
    {
        var services = new ServiceCollection().AddDocStore(Config(("DocStore:Mode", "Http")), Environment(Environments.Production));

        Assert.Equal(typeof(DisabledDocStoreClient), Registered(services));
    }

    [Fact]
    public void DocStore_InMemory_IsForLocalDevelopmentOnly()
    {
        var development = new ServiceCollection().AddDocStore(Config(("DocStore:Mode", "InMemory")), Environment(Environments.Development));

        Assert.Equal(typeof(InMemoryDocStoreClient), Registered(development));
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection()
            .AddDocStore(Config(("DocStore:Mode", "InMemory")), Environment(Environments.Production)));
    }

    [Fact]
    public void DocStore_HttpWithBaseUrlAndScope_IsTheRealClient()
    {
        var services = new ServiceCollection().AddDocStore(
            Config(("DocStore:Mode", "Http"), ("DocStore:BaseUrl", "https://apiqa.scoular.com/internal/docstore/v1"),
                ("DocStore:Scope", "api://f9577a19-eac4-45f8-997d-e956d6154430/.default")),
            Environment(Environments.Production));

        // Built by a factory (it needs the credential), so the descriptor names no implementation type.
        var descriptor = services.Single(d => d.ServiceType == typeof(IDocStoreClient));
        Assert.NotNull(descriptor.ImplementationFactory);
    }
}
