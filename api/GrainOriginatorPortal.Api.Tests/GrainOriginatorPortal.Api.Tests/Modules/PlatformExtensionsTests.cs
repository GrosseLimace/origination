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
using GrainOriginatorPortal.Infrastructure;
using GrainOriginatorPortal.Infrastructure.Platform.Extensions;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// Platform declares an extension when one module needs an answer only another module has, and the two must not
/// depend on each other: Bid Sheet asks who is in a recap group, and Engagement answers. Nothing has a fallback,
/// so the app must register an implementation of every one.
/// </summary>
public class PlatformExtensionsTests
{
    private const string Extensions = "GrainOriginatorPortal.Infrastructure.Platform.Extensions";

    [Fact]
    public void EveryPlatformExtension_IsProvidedByAModule()
    {
        // Registered the way Program.cs does it, so whichever module provides an extension is found.
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();
        services.AddInfrastructure(configuration);
        services.AddCustomersModule();
        services.AddContractsModule();
        services.AddEngagementModule();
        services.AddProducersModule(configuration);
        services.AddListsModule();
        services.AddBidSheetModule();
        services.AddUsageAnalyticsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        var extensions = typeof(IRecapGroupMembership).Assembly.GetTypes()
            .Where(t => t.IsInterface && t.Namespace == Extensions)
            .ToList();

        Assert.NotEmpty(extensions);
        Assert.All(extensions, e => Assert.Contains(e, registered));
    }
}
