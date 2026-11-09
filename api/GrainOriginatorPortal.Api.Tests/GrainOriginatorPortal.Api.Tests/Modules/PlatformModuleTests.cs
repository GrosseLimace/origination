// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.BidSheet;
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Engagement;
using GrainOriginatorPortal.Api.Modules.Lists;
using GrainOriginatorPortal.Api.Modules.Producers;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics;
using GrainOriginatorPortal.Api.Platform;
using GrainOriginatorPortal.Api.Platform.Identity;
using GrainOriginatorPortal.Infrastructure.Platform;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="PlatformModule.AddPlatform"/> and the modules, registered the way Program.cs does it, provide what
/// every controller, service and background job in the app takes in its constructor. No test starts the app, so
/// without this a registration lost on the way out of Program.cs would only show when someone ran it.
/// </summary>
public class PlatformModuleTests
{
    /// <summary>What the host registers itself, before Program.cs runs.</summary>
    private static readonly HashSet<Type> FromTheHost =
    [
        typeof(IConfiguration),
        typeof(IHostEnvironment),
        typeof(IWebHostEnvironment),
        typeof(IHostApplicationLifetime),
        typeof(ILoggerFactory),
        typeof(ILogger<>),
        typeof(IServiceProvider),
        typeof(IServiceScopeFactory),
    ];

    private sealed class ProductionEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "GrainOriginatorPortal.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static ServiceCollection TheAppsServices()
    {
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();
        services
            .AddPlatform(configuration, new ProductionEnvironment())
            .AddCustomersModule()
            .AddContractsModule()
            .AddEngagementModule()
            .AddProducersModule(configuration)
            .AddListsModule()
            .AddBidSheetModule()
            .AddUsageAnalyticsModule();
        return services;
    }

    private static bool IsOurs(Type type) =>
        type.Assembly == typeof(PlatformModule).Assembly || type.Assembly == typeof(PlatformInfrastructure).Assembly;

    [Fact]
    public void EveryControllerServiceAndJob_GetsWhatItsConstructorTakes()
    {
        var services = TheAppsServices();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        bool Provided(Type type) =>
            registered.Contains(type)
            || FromTheHost.Contains(type)
            || (type.IsGenericType && (registered.Contains(type.GetGenericTypeDefinition())
                                       || FromTheHost.Contains(type.GetGenericTypeDefinition())
                                       || type.GetGenericTypeDefinition() == typeof(IEnumerable<>)));

        // Every controller (MVC builds them from the container), and every class of ours the container builds.
        var controllers = typeof(PlatformModule).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t));
        var built = services.Select(d => d.ImplementationType).OfType<Type>().Where(IsOurs);

        var missing = controllers.Concat(built)
            .Distinct()
            .SelectMany(type => type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .SelectMany(ctor => ctor.GetParameters())
                .Where(parameter => !parameter.IsOptional && !Provided(parameter.ParameterType))
                .Select(parameter => $"{type.Name} needs {parameter.ParameterType.Name}"))
            .Distinct()
            .ToList();

        Assert.True(missing.Count == 0, "Not registered by AddPlatform or any module: " + string.Join("; ", missing));
    }

    [Fact]
    public void TheCheckAbove_SeesPlatformsOwnServices()
    {
        // If AddPlatform stopped registering by implementation type, the check above would pass on nothing of Platform's.
        var built = TheAppsServices().Select(d => d.ImplementationType).OfType<Type>().ToList();

        Assert.Contains(typeof(UserEntitlementService), built);
        Assert.Contains(typeof(RequestContextService), built);
    }
}
