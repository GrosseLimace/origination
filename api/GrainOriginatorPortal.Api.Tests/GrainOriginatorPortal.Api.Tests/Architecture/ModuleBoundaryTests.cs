// System namespaces
using System.Reflection;

// Third-party namespaces
using ArchUnitNET.Fluent;
using ArchUnitNET.Loader;
using static ArchUnitNET.Fluent.ArchRuleDefinition;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Architecture;

/// <summary>
/// Which module may depend on which, read from the compiled Api and Infrastructure assemblies.
/// </summary>
/// <remarks>
/// A module's code lives in <c>Api.Modules.&lt;Module&gt;</c> and <c>Infrastructure.Modules.&lt;Module&gt;</c>,
/// and each rule matches on those namespaces. Code that hasn't moved into its module yet isn't checked,
/// so a rule starts to bite as soon as the modules it names have moved.
/// </remarks>
public class ModuleBoundaryTests
{
    private static readonly ArchUnitNET.Domain.Architecture Code = new ArchLoader()
        .LoadAssemblies(typeof(MeController).Assembly, typeof(ApplicationDbContext).Assembly)
        .Build();

    /// <summary>The business modules: every nested class of <see cref="AppPermissions"/> except Platform.</summary>
    public static TheoryData<string> Modules() =>
        new(typeof(AppPermissions).GetNestedTypes(BindingFlags.Public)
            .Select(module => module.Name)
            .Where(name => name != nameof(AppPermissions.Platform)));

    private static string InModule(string module) =>
        $@"^GrainOriginatorPortal\.(Api|Infrastructure)\.Modules\.{module}(\..+)?$";

    /// <summary>
    /// Producers builds on Customers, Contracts and Engagement, never the other way round. The shared
    /// modules must work without any producer code, which is what lets a trader see a customer without
    /// the producer screens.
    /// </summary>
    [Theory]
    [InlineData("Customers")]
    [InlineData("Contracts")]
    [InlineData("Engagement")]
    public void SharedModules_DoNotDependOnProducers(string module)
    {
        var rule = Types().That().ResideInNamespaceMatching(InModule(module))
            .Should().NotDependOnAny(Types().That().ResideInNamespaceMatching(InModule("Producers")))
            .WithoutRequiringPositiveResults();

        AssertHolds(rule);
    }

    /// <summary>
    /// A module reaches another module's data only through that module's services, never through its
    /// repositories, their interfaces, or its entities (which a DbSet on the shared DbContext would expose).
    /// </summary>
    [Theory]
    [MemberData(nameof(Modules))]
    public void AModule_UsesNoOtherModulesRepositoriesOrEntities(string module)
    {
        var anotherModulesData =
            $@"^GrainOriginatorPortal\.Infrastructure\.Modules\.(?!{module}\.)[^.]+\.(Repositories|Interfaces|Entities)(\..+)?$";

        var rule = Types().That().ResideInNamespaceMatching(InModule(module))
            .Should().NotDependOnAny(Types().That().ResideInNamespaceMatching(anotherModulesData))
            .WithoutRequiringPositiveResults();

        AssertHolds(rule);
    }

    [Fact]
    public void TheRules_SeeARealDependency()
    {
        // Until modules move, the rules above match nothing and pass. This proves a rule of the same shape
        // does fail on a dependency the code really has: the access endpoints use the permission catalog.
        var rule = Types().That().ResideInNamespaceMatching(@"^GrainOriginatorPortal\.Api\.Platform\.Access(\..+)?$")
            .Should().NotDependOnAny(
                Types().That().ResideInNamespaceMatching(@"^GrainOriginatorPortal\.Infrastructure\.Platform\.Access(\..+)?$"));

        Assert.Contains(rule.Evaluate(Code), result => !result.Passed);
    }

    private static void AssertHolds(IArchRule rule)
    {
        var violations = rule.Evaluate(Code)
            .Where(result => !result.Passed)
            .Select(result => result.Description)
            .ToList();

        Assert.True(violations.Count == 0,
            rule.Description + Environment.NewLine + string.Join(Environment.NewLine, violations));
    }
}
