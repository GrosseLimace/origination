// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Customers.Services;
using GrainOriginatorPortal.Api.Modules.Producers;
using GrainOriginatorPortal.Infrastructure.Platform;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="CustomersModule.AddCustomersModule"/> registers what the module's controllers, its sync and the
/// other modules' lookups need. No test starts the app, so without this a forgotten registration would only show
/// when someone ran it.
/// </summary>
public class CustomersModuleTests
{
    private const string ApiModule = "GrainOriginatorPortal.Api.Modules.Customers";
    private const string InfrastructureModule = "GrainOriginatorPortal.Infrastructure.Modules.Customers";

    /// <summary>Interfaces Customers declares and other modules implement, such as the open-activity check.</summary>
    private const string Extensions = "GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions";

    private static bool InModule(Type type) =>
        type.Namespace is { } ns && (ns.StartsWith(ApiModule, StringComparison.Ordinal)
                                     || ns.StartsWith(InfrastructureModule, StringComparison.Ordinal));

    [Fact]
    public void EveryCustomersTypeThatAControllerOrServiceNeeds_IsRegistered()
    {
        var services = new ServiceCollection();
        services.AddCustomersModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        // The module's controllers, and every module class registered here, constructed by DI. Platform
        // services they need (the CTRM client, the request context, the DbContexts) are registered by Program.cs.
        var controllers = typeof(CustomersModule).Assembly.GetTypes()
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
            .Where(x => InModule(x.Needed) && x.Needed.Namespace != Extensions && !registered.Contains(x.Needed))
            .Select(x => $"{x.Needer.Name} needs {x.Needed.Name}")
            .Distinct()
            .ToList();

        Assert.NotEmpty(controllers);
        Assert.True(missing.Count == 0, "Not registered by AddCustomersModule: " + string.Join("; ", missing));
    }

    [Fact]
    public void TheLookupOtherModulesUse_IsRegistered()
    {
        // Producers injects ICustomerLookup, and nothing in this module does, so the check above can't see it.
        var services = new ServiceCollection();
        services.AddCustomersModule();

        Assert.Single(services, d => d.ServiceType == typeof(ICustomerLookup) && d.ImplementationType == typeof(CustomerLookup));
    }

    [Fact]
    public void EveryExtensionCustomersNeeds_IsProvidedByAnotherModule()
    {
        // Customers declares these and has no fallback of its own, so the app must register an implementation.
        // The open-activity check is Contracts data; AddContractsModule registers it. Registered here the way
        // Program.cs does it, so whichever module provides an extension is found.
        var configuration = new ConfigurationBuilder().Build();
        var services = new ServiceCollection();
        services.AddPlatformInfrastructure(configuration);
        services.AddCustomersModule();
        services.AddContractsModule();
        services.AddProducersModule(configuration);
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        var extensions = typeof(ICustomerActivitySource).Assembly.GetTypes()
            .Where(t => t.IsInterface && t.Namespace == Extensions)
            .ToList();

        Assert.NotEmpty(extensions);
        Assert.All(extensions, e => Assert.Contains(e, registered));
    }
}
