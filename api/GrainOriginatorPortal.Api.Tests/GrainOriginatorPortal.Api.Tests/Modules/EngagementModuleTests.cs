// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Engagement;
using GrainOriginatorPortal.Api.Modules.Engagement.Services;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="EngagementModule.AddEngagementModule"/> registers what the module's controllers need, and the
/// Graph client that creates Outlook events without retrying. No test starts the app, so without this a
/// forgotten registration would only show when someone ran it.
/// </summary>
public class EngagementModuleTests
{
    private const string ApiModule = "GrainOriginatorPortal.Api.Modules.Engagement";
    private const string InfrastructureModule = "GrainOriginatorPortal.Infrastructure.Modules.Engagement";

    private static bool InModule(Type type) =>
        type.Namespace is { } ns && (ns.StartsWith(ApiModule, StringComparison.Ordinal)
                                     || ns.StartsWith(InfrastructureModule, StringComparison.Ordinal));

    [Fact]
    public void EveryEngagementTypeThatAControllerOrServiceNeeds_IsRegistered()
    {
        var services = new ServiceCollection();
        services.AddEngagementModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        // The module's controllers, and every module class registered here, constructed by DI. Platform
        // services they need (the request context, the entitlements directory, the shared "graph" client) and
        // the Customers lookup are registered by Program.cs and AddCustomersModule.
        var controllers = typeof(EngagementModule).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t) && InModule(t))
            .ToList();
        var implementations = services
            .Select(d => d.ImplementationType)
            .OfType<Type>()
            .Where(InModule);

        var missing = controllers.Concat(implementations)
            .SelectMany(type => type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .SelectMany(ctor => ctor.GetParameters())
                .Select(parameter => (Needer: type, Needed: parameter.ParameterType)))
            .Where(x => InModule(x.Needed) && !registered.Contains(x.Needed))
            .Select(x => $"{x.Needer.Name} needs {x.Needed.Name}")
            .Distinct()
            .ToList();

        Assert.NotEmpty(controllers);
        Assert.True(missing.Count == 0, "Not registered by AddEngagementModule: " + string.Join("; ", missing));
    }

    [Fact]
    public void TheNoRetryGraphClient_IsRegisteredUnderTheNameTheCalendarServiceUses()
    {
        // Creating an Outlook event must go through this client: the shared "graph" client retries, and a
        // retried POST /me/events puts a second event on the user's calendar.
        var services = new ServiceCollection();
        services.AddEngagementModule();
        using var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptionsMonitor<HttpClientFactoryOptions>>().Get(OutlookCalendarService.NoRetryClient);
        var client = new HttpClient();
        foreach (var configure in options.HttpClientActions) configure(client);

        Assert.Equal(new Uri("https://graph.microsoft.com/v1.0/"), client.BaseAddress);
    }
}
