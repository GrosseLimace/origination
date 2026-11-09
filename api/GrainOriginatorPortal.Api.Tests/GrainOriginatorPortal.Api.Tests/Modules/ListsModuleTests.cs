// System namespaces
using System.Reflection;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.Lists;

namespace GrainOriginatorPortal.Api.Tests.Modules;

/// <summary>
/// <see cref="ListsModule.AddListsModule"/> registers what the module's controllers need. No test starts the
/// app, so without this a forgotten registration would only show when someone ran it.
/// </summary>
public class ListsModuleTests
{
    private const string ApiModule = "GrainOriginatorPortal.Api.Modules.Lists";
    private const string InfrastructureModule = "GrainOriginatorPortal.Infrastructure.Modules.Lists";

    private static bool InModule(Type type) =>
        type.Namespace is { } ns && (ns.StartsWith(ApiModule, StringComparison.Ordinal)
                                     || ns.StartsWith(InfrastructureModule, StringComparison.Ordinal));

    [Fact]
    public void EveryListsTypeThatAControllerOrServiceNeeds_IsRegistered()
    {
        var services = new ServiceCollection();
        services.AddListsModule();
        var registered = services.Select(d => d.ServiceType).ToHashSet();

        // The module's controllers, and every module class registered here, constructed by DI. Platform
        // services they need (the request context, entitlements, the permission check) are registered by
        // Program.cs.
        var controllers = typeof(ListsModule).Assembly.GetTypes()
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
        Assert.True(missing.Count == 0, "Not registered by AddListsModule: " + string.Join("; ", missing));
    }
}
