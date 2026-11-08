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
/// so a rule starts to bite as soon as the modules it names have moved. Platform isn't under
/// <c>Modules</c>: every module may use it.
/// </remarks>
public class ModuleBoundaryTests
{
    private static readonly ArchUnitNET.Domain.Architecture Code = new ArchLoader()
        .LoadAssemblies(typeof(MeController).Assembly, typeof(ApplicationDbContext).Assembly)
        .Build();

    /// <summary>
    /// The modules each module builds on, as the module map's "Depends on" column has them. The reverse is
    /// never allowed: Customers, Contracts and Engagement must work without any producer code, which is what
    /// lets a trader see a customer without the producer screens.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string[]> DependsOn = new Dictionary<string, string[]>
    {
        ["Customers"] = [],
        ["Contracts"] = ["Customers"],
        ["Engagement"] = ["Customers"],
        ["Producers"] = ["Contracts", "Customers"],
        ["Lists"] = ["Producers", "Contracts", "Customers"],
        ["BidSheet"] = [],
        // The usage dashboard names the customers, contracts and query-library prompts people used.
        ["UsageAnalytics"] = ["Lists", "Contracts", "Customers"],
    };

    /// <summary>The business modules: every nested class of <see cref="AppPermissions"/> except Platform.</summary>
    private static IEnumerable<string> ModuleNames() =>
        typeof(AppPermissions).GetNestedTypes(BindingFlags.Public)
            .Select(module => module.Name)
            .Where(name => name != nameof(AppPermissions.Platform));

    public static TheoryData<string> Modules() => new(ModuleNames());

    private static string InModule(string module) =>
        $@"^GrainOriginatorPortal\.(Api|Infrastructure)\.Modules\.{module}(\..+)?$";

    [Fact]
    public void EveryModule_SaysWhichModulesItBuildsOn()
    {
        Assert.Equal(
            ModuleNames().Order(StringComparer.Ordinal),
            DependsOn.Keys.Order(StringComparer.Ordinal));
    }

    /// <summary>
    /// A module may use the modules it builds on (their services, models and, in the one shared DbContext,
    /// their entities for joins and foreign keys) and no others.
    /// </summary>
    [Theory]
    [MemberData(nameof(Modules))]
    public void AModule_DependsOnlyOnTheModulesItBuildsOn(string module)
    {
        var allowed = string.Join("|", DependsOn[module].Append(module));
        var anyOtherModule = $@"^GrainOriginatorPortal\.(Api|Infrastructure)\.Modules\.(?!(?:{allowed})(?:\.|$))[^.]+(\..+)?$";

        var rule = Types().That().ResideInNamespaceMatching(InModule(module))
            .Should().NotDependOnAny(Types().That().ResideInNamespaceMatching(anyOtherModule))
            .WithoutRequiringPositiveResults();

        AssertHolds(rule);
    }

    /// <summary>
    /// Even a module it builds on is reached through its services, never its repositories or their
    /// interfaces: a repository is how a module keeps its own rules (scoping, soft deletes, audit) in one place.
    /// </summary>
    [Theory]
    [MemberData(nameof(Modules))]
    public void AModule_UsesNoOtherModulesRepositories(string module)
    {
        var anotherModulesRepositories =
            $@"^GrainOriginatorPortal\.Infrastructure\.Modules\.(?!{module}\.)[^.]+\.(Repositories|Interfaces)(\..+)?$";

        var rule = Types().That().ResideInNamespaceMatching(InModule(module))
            .Should().NotDependOnAny(Types().That().ResideInNamespaceMatching(anotherModulesRepositories))
            .WithoutRequiringPositiveResults();

        AssertHolds(rule);
    }

    [Fact]
    public void TheRules_SeeARealDependency()
    {
        // Until modules move, the rules above match little and pass. This proves a rule of the same shape
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
