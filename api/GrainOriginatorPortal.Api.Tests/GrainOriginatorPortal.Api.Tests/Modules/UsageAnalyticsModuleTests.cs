// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Lists;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="UsageAnalyticsModule.AddUsageAnalyticsModule"/> registers what the module's controller and services
/// need, and the modules it builds on register what it asks them for. No test starts the app, so without this a
/// forgotten registration would only show when someone ran it.
/// </summary>
public class UsageAnalyticsModuleTests
{
    private static bool InModule(Type type, string module) =>
        type.Namespace is { } ns && (ns.StartsWith($"GrainOriginatorPortal.Api.Modules.{module}", StringComparison.Ordinal)
                                     || ns.StartsWith($"GrainOriginatorPortal.Infrastructure.Modules.{module}", StringComparison.Ordinal));

    /// <summary>The module's controllers and the module classes it registers, constructed by DI.</summary>
    private static List<Type> Needers(IServiceCollection services) =>
        typeof(UsageAnalyticsModule).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t)
                        && InModule(t, "UsageAnalytics"))
            .Concat(services.Select(d => d.ImplementationType).OfType<Type>().Where(t => InModule(t, "UsageAnalytics")))
            .ToList();

    private static IEnumerable<(Type Needer, Type Needed)> Needs(IEnumerable<Type> types) =>
        types.SelectMany(type => type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .SelectMany(ctor => ctor.GetParameters())
            .Select(parameter => (type, parameter.ParameterType)));

    [Fact]
    public void EveryUsageAnalyticsTypeThatAControllerOrServiceNeeds_IsRegistered()
    {
        var services = new ServiceCollection();
        services.AddUsageAnalyticsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();
        var needers = Needers(services);

        // Platform services they need (the cache, app access, the permission check) are registered by Program.cs.
        var missing = Needs(needers)
            .Where(x => InModule(x.Needed, "UsageAnalytics") && !registered.Contains(x.Needed))
            .Select(x => $"{x.Needer.Name} needs {x.Needed.Name}")
            .Distinct()
            .ToList();

        Assert.NotEmpty(needers);
        Assert.True(missing.Count == 0, "Not registered by AddUsageAnalyticsModule: " + string.Join("; ", missing));
    }

    [Fact]
    public void WhatItAsksTheModulesItBuildsOn_TheyRegister()
    {
        // The dashboard names customers, contracts and prompts through those modules' services.
        var services = new ServiceCollection();
        services.AddUsageAnalyticsModule();
        var needers = Needers(services);
        services.AddCustomersModule();
        services.AddContractsModule();
        services.AddListsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        var needs = Needs(needers)
            .Where(x => new[] { "Customers", "Contracts", "Lists" }.Any(m => InModule(x.Needed, m)))
            .ToList();
        var missing = needs
            .Where(x => !registered.Contains(x.Needed))
            .Select(x => $"{x.Needer.Name} needs {x.Needed.Name}")
            .Distinct()
            .ToList();

        Assert.Equal(3, needs.Select(x => x.Needed).Distinct().Count());
        Assert.True(missing.Count == 0, "Not registered by the module that owns it: " + string.Join("; ", missing));
    }
}
