// Microsoft namespaces
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Proves <see cref="DiagnosticsServiceCollectionExtensions.AddDiagnosticsServices"/> registers
/// every service DiagnosticsController depends on, against the same dependency shapes Program.cs
/// and Infrastructure/DependencyInjection.cs provide (scoped DbContexts and repositories, singleton
/// CTRM client/readers, scoped provenance). Built with scope validation on, so a captive-dependency
/// mistake (a scoped DbContext inside a singleton service) fails here rather than at first request.
/// </summary>
public class DiagnosticsServiceCollectionExtensionsTests
{
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());

        // Provider-less contexts: constructed but never queried, which is all resolution needs.
        services.AddScoped(_ => new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>().Options));
        services.AddScoped(_ => new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().Options));
        services.AddScoped(_ => new TradeUnitPreferencesDbContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>().Options));

        // Lifetimes mirror the real registrations.
        services.AddSingleton(new Mock<ICtrmGraphQlClient>().Object);
        services.AddSingleton<CtrmContractReader>();
        services.AddSingleton<CtrmTicketReader>();
        services.AddScoped<CtrmProvenance>();
        services.AddScoped(_ => new Mock<IContractRepository>().Object);
        services.AddScoped(_ => new Mock<ITicketRepository>().Object);
        services.AddScoped(_ => new Mock<IUsageRepository>().Object);
        services.AddSingleton(new Mock<IHttpClientFactory>().Object);
        services.AddSingleton(new Mock<IGraphDirectoryClient>().Object);
        services.AddSingleton(new Mock<IWebHostEnvironment>().Object);
        services.AddSingleton<CustomerSyncService>();

        services.AddDiagnosticsServices();

        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    public static IEnumerable<object[]> ServiceInterfaces()
    {
        yield return [typeof(ISchemaDiagnosticsService), typeof(SchemaDiagnosticsService)];
        yield return [typeof(ICtrmDiagnosticsService), typeof(CtrmDiagnosticsService)];
        yield return [typeof(ICommoditySeedService), typeof(CommoditySeedService)];
        yield return [typeof(IElevatorCacheDiagnosticsService), typeof(ElevatorCacheDiagnosticsService)];
        yield return [typeof(IUsageRollupBackfillService), typeof(UsageRollupBackfillService)];
        yield return [typeof(IAppAccessDiagnosticsService), typeof(AppAccessDiagnosticsService)];
    }

    [Theory]
    [MemberData(nameof(ServiceInterfaces))]
    public void EachDiagnosticsService_Resolves_ToItsImplementation(Type serviceType, Type implementationType)
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var resolved = scope.ServiceProvider.GetRequiredService(serviceType);

        Assert.IsType(implementationType, resolved);
    }

    [Fact]
    public void DiagnosticsController_CanBeConstructedFromTheRegistrations()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var controller = ActivatorUtilities.CreateInstance<DiagnosticsController>(scope.ServiceProvider);

        Assert.NotNull(controller);
    }

    [Fact]
    public void AddDiagnosticsServices_ReturnsTheCollection_ForChaining()
    {
        var services = new ServiceCollection();

        Assert.Same(services, services.AddDiagnosticsServices());
        Assert.Equal(6, services.Count);
        Assert.All(services, d => Assert.Equal(ServiceLifetime.Scoped, d.Lifetime));
    }
}
