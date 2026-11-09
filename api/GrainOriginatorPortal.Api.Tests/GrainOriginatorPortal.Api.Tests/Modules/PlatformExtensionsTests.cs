// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.BidSheet;
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Engagement;
using GrainOriginatorPortal.Api.Modules.Lists;
using GrainOriginatorPortal.Api.Modules.Producers;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics;
using GrainOriginatorPortal.Infrastructure.Platform;
using GrainOriginatorPortal.Infrastructure.Platform.Extensions;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// Platform declares an extension when it needs an answer only a module has, since Platform may not depend on a
/// module: the entitlement check asks Customers which trade units a customer is in, and the commodity seed asks
/// Contracts for the commodities on purchase contracts. Nothing has a fallback, so the app must register an
/// implementation of every one.
/// </summary>
public class PlatformExtensionsTests
{
    private const string Extensions = "GrainOriginatorPortal.Infrastructure.Platform.Extensions";

    [Fact]
    public void EveryPlatformExtension_IsProvidedByAModule()
    {
        // Platform's infrastructure, then every module, the way the app registers them, so whichever module provides an
        // extension is found.
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();
        services.AddPlatformInfrastructure(configuration);
        services.AddCustomersModule();
        services.AddContractsModule();
        services.AddEngagementModule();
        services.AddProducersModule(configuration);
        services.AddListsModule();
        services.AddBidSheetModule();
        services.AddUsageAnalyticsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        var extensions = typeof(ICustomerTradeUnits).Assembly.GetTypes()
            .Where(t => t.IsInterface && t.Namespace == Extensions)
            .ToList();

        Assert.NotEmpty(extensions);
        Assert.All(extensions, e => Assert.Contains(e, registered));
    }
}
