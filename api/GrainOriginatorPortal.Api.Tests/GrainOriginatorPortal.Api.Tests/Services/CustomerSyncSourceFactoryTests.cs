// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts;
using GrainOriginatorPortal.Infrastructure.Modules.Customers;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Sync;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The real registrations (<see cref="PlatformInfrastructure.AddPlatformInfrastructure"/> for the DbContexts, then
/// <see cref="CustomersInfrastructure.AddCustomersInfrastructure"/>) resolve both sync feeders through the factory,
/// from a scope, with scope validation on. The service resolves the factory from each run's scope, so the feeders
/// must be scoped (they hold the scoped sync repository) and must never be resolvable from the root.
/// </summary>
public class CustomerSyncSourceFactoryTests
{
    private static ServiceProvider Build()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddPlatformInfrastructure(configuration);
        services.AddCustomersInfrastructure();
        // The customer repository asks Contracts which trade units have open activity.
        services.AddContractsInfrastructure();
        // Registered by the Api project in the app (it needs IHttpClientFactory and a credential).
        services.AddSingleton(new Mock<ICtrmGraphQlClient>().Object);
        // The real repository needs SQL Server; the feeders only need something scoped behind the interface.
        services.AddScoped(_ => new Mock<ICustomerSyncRepository>().Object);
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    [Fact]
    public void Create_ResolvesTheCtrmFeederForCtrm_AndTheOdsFeederOtherwise()
    {
        using var provider = Build();
        using var scope = provider.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<ICustomerSyncSourceFactory>();

        Assert.IsType<CtrmCustomerSyncSource>(factory.Create("ctrm"));
        Assert.IsType<CtrmCustomerSyncSource>(factory.Create(" CTRM "));
        Assert.IsType<OdsCustomerSyncSource>(factory.Create("ods"));
        Assert.IsType<OdsCustomerSyncSource>(factory.Create("graphql"));
    }

    [Fact]
    public void AddCustomersInfrastructure_RegistersTheFeedersAndFactoryScoped_AndTheCustomerReadersAsSingletons()
    {
        var services = new ServiceCollection();
        services.AddCustomersInfrastructure();

        ServiceLifetime LifetimeOf<T>() => Assert.Single(services, d => d.ServiceType == typeof(T)).Lifetime;

        Assert.Equal(ServiceLifetime.Scoped, LifetimeOf<ICustomerSyncSourceFactory>());
        Assert.Equal(ServiceLifetime.Scoped, LifetimeOf<OdsCustomerSyncSource>());
        Assert.Equal(ServiceLifetime.Scoped, LifetimeOf<CtrmCustomerSyncSource>());
        Assert.Equal(ServiceLifetime.Singleton, LifetimeOf<CtrmCustomerReader>());
        Assert.Equal(ServiceLifetime.Singleton, LifetimeOf<CtrmCustomerActivityReader>());
    }

    [Fact]
    public void Factory_IsNotResolvableFromTheRoot()
    {
        using var provider = Build();

        Assert.Throws<InvalidOperationException>(() => provider.GetRequiredService<ICustomerSyncSourceFactory>());
    }
}
