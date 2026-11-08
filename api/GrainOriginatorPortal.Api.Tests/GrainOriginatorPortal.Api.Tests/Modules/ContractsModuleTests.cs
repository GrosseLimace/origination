// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Contracts.Services;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Producers;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="ContractsModule.AddContractsModule"/> registers what the module's controllers, its keep-warm
/// service and the modules built on it need. No test starts the app, so without this a forgotten registration
/// would only show when someone ran it.
/// </summary>
public class ContractsModuleTests
{
    private const string ApiModule = "GrainOriginatorPortal.Api.Modules.Contracts";
    private const string InfrastructureModule = "GrainOriginatorPortal.Infrastructure.Modules.Contracts";

    private static bool InModule(Type type) =>
        type.Namespace is { } ns && (ns.StartsWith(ApiModule, StringComparison.Ordinal)
                                     || ns.StartsWith(InfrastructureModule, StringComparison.Ordinal));

    /// <summary>Each Contracts type the constructors of <paramref name="types"/> take, with the type taking it.</summary>
    private static List<(Type Needer, Type Needed)> ContractsNeeds(IEnumerable<Type> types) =>
        types
            .SelectMany(type => type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .SelectMany(ctor => ctor.GetParameters())
                .Select(parameter => (Needer: type, Needed: parameter.ParameterType)))
            .Where(x => InModule(x.Needed))
            .ToList();

    private static List<string> Unregistered(IEnumerable<(Type Needer, Type Needed)> needs, HashSet<Type> registered) =>
        needs
            .Where(x => !registered.Contains(x.Needed))
            .Select(x => $"{x.Needer.Name} needs {x.Needed.Name}")
            .Distinct()
            .ToList();

    [Fact]
    public void EveryContractsTypeThatAControllerOrServiceNeeds_IsRegistered()
    {
        var services = new ServiceCollection();
        services.AddContractsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        // The module's controllers, and every module class registered here, constructed by DI. Platform
        // services they need (the CTRM client, the provenance record, the DbContexts) are registered by
        // AddInfrastructure and Program.cs.
        var controllers = typeof(ContractsModule).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t) && InModule(t))
            .ToList();
        var implementations = services
            .Select(d => d.ImplementationType)
            .OfType<Type>()
            .Where(InModule);

        var missing = Unregistered(ContractsNeeds(controllers.Concat(implementations)), registered);

        Assert.NotEmpty(controllers);
        Assert.True(missing.Count == 0, "Not registered by AddContractsModule: " + string.Join("; ", missing));
    }

    [Fact]
    public void EveryContractsTypeAnotherModuleNeeds_IsRegistered()
    {
        // Producers' pacing controller takes the contract service and its field-ticket reader takes the CTRM
        // readers; the check above only looks inside this module, so it can't see them.
        var others = new ServiceCollection();
        others.AddCustomersModule();
        others.AddProducersModule(new ConfigurationBuilder().Build());
        var otherModulesControllers = typeof(ContractsModule).Assembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ControllerBase).IsAssignableFrom(t)
                        && t.Namespace?.StartsWith("GrainOriginatorPortal.Api.Modules.", StringComparison.Ordinal) == true
                        && !InModule(t));
        var needs = ContractsNeeds(otherModulesControllers.Concat(others.Select(d => d.ImplementationType).OfType<Type>()));

        var services = new ServiceCollection();
        services.AddContractsModule();
        var missing = Unregistered(needs, services.Select(d => d.ServiceType).ToHashSet());

        Assert.NotEmpty(needs);
        Assert.True(missing.Count == 0, "Not registered by AddContractsModule: " + string.Join("; ", missing));
    }

    [Fact]
    public void TheKeepWarmService_RunsWithTheModule()
    {
        var services = new ServiceCollection();
        services.AddContractsModule();

        Assert.Single(services, d => d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(CtrmKeepWarmService));
    }
}
