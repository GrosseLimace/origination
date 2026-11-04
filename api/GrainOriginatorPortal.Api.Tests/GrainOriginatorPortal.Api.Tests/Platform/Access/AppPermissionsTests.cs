// System namespaces
using System.Reflection;
using System.Text.RegularExpressions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

/// <summary>
/// Pins the shape of the permission catalog. These tests read the constants by reflection, apart
/// from <see cref="AppPermissions.All"/> and <see cref="AppPermissions.ModuleOf"/>, so a bug in how
/// the catalog builds itself can't hide a bad constant.
/// </summary>
public class AppPermissionsTests
{
    // The style guide's format (§4.1), with this app's actions: read; write, one custom action covering
    // create, update and delete (§4.2 allows a custom action when the standard set doesn't fit);
    // manage for IT's operational powers; and delete only as a scoped extra power (see below).
    // Adding an action should be a deliberate choice, so the list is pinned.
    private static readonly Regex Format = new(
        "^(?<resource>[a-z]+(-[a-z]+)*):(?<action>read|write|manage|delete)(:(?<scope>own|team|department|global))?$");

    private static IEnumerable<(string Module, string Name, string Value)> Constants() =>
        typeof(AppPermissions).GetNestedTypes(BindingFlags.Public)
            .SelectMany(module => module.GetFields(BindingFlags.Public | BindingFlags.Static)
                .Where(f => f is { IsLiteral: true, IsInitOnly: false } && f.FieldType == typeof(string))
                .Select(f => (module.Name, f.Name, (string)f.GetRawConstantValue()!)));

    [Fact]
    public void EveryPermission_FollowsTheStyleGuideFormat()
    {
        var malformed = Constants().Where(c => !Format.IsMatch(c.Value)).Select(c => $"{c.Name} = '{c.Value}'").ToList();

        Assert.True(malformed.Count == 0,
            $"Permissions must be resource:action[:scope] with a standard action: {string.Join(", ", malformed)}");
    }

    [Fact]
    public void Delete_IsOnlyAnExtraPowerOverOtherPeoplesRecords()
    {
        // Whoever may write a resource may delete it, so a plain delete permission would only split write
        // again. A delete permission exists only to reach past the service's own-records rule.
        var plainDeletes = Constants()
            .Where(c => Format.Match(c.Value) is { Success: true } m
                        && m.Groups["action"].Value == "delete"
                        && m.Groups["scope"].Value is not ("team" or "department" or "global"))
            .Select(c => c.Value)
            .ToList();

        Assert.True(plainDeletes.Count == 0,
            $"Use the resource's write permission instead of: {string.Join(", ", plainDeletes)}");
    }

    [Fact]
    public void EveryPermission_IsDeclaredOnce()
    {
        var duplicates = Constants().GroupBy(c => c.Value).Where(g => g.Count() > 1).Select(g => g.Key).ToList();

        Assert.True(duplicates.Count == 0, $"Declared more than once: {string.Join(", ", duplicates)}");
    }

    [Fact]
    public void EveryResource_BelongsToExactlyOneModule()
    {
        var shared = Constants()
            .GroupBy(c => Format.Match(c.Value).Groups["resource"].Value)
            .Where(g => g.Select(c => c.Module).Distinct().Count() > 1)
            .Select(g => $"{g.Key} ({string.Join(", ", g.Select(c => c.Module).Distinct())})")
            .ToList();

        Assert.True(shared.Count == 0, $"Resources split across modules: {string.Join("; ", shared)}");
    }

    [Fact]
    public void EveryConstantName_SpellsItsValue()
    {
        // Catches copy-paste slips such as NotesWrite = "notes:read".
        var mismatched = Constants()
            .Where(c => c.Name != ToPascalCase(c.Value))
            .Select(c => $"{c.Name} = '{c.Value}' (expected {ToPascalCase(c.Value)})")
            .ToList();

        Assert.True(mismatched.Count == 0, $"Constant names must spell their values: {string.Join(", ", mismatched)}");
    }

    [Fact]
    public void All_HoldsEveryConstantInOrdinalOrder()
    {
        var expected = Constants().Select(c => c.Value).Order(StringComparer.Ordinal).ToList();

        Assert.Equal(expected, AppPermissions.All);
    }

    [Fact]
    public void ModuleOf_GivesEachPermissionItsModuleId()
    {
        Assert.Equal(AppPermissions.All.Count, AppPermissions.ModuleOf.Count);
        Assert.Equal("platform", AppPermissions.ModuleOf[AppPermissions.Platform.RolesManage]);
        Assert.Equal("bid-sheet", AppPermissions.ModuleOf[AppPermissions.BidSheet.BidSheetsRead]);
        Assert.Equal("usage-analytics", AppPermissions.ModuleOf[AppPermissions.UsageAnalytics.UsageReportsRead]);
    }

    [Fact]
    public void ModuleIds_MatchThePlannedModules()
    {
        // The client's module manifests use these ids, so renaming a nested class is a contract change.
        string[] expected = ["bid-sheet", "contracts", "customers", "engagement", "lists", "platform", "producers", "usage-analytics"];

        Assert.Equal(expected, AppPermissions.ModuleOf.Values.Distinct().Order(StringComparer.Ordinal));
    }

    private static string ToPascalCase(string permission) =>
        string.Concat(permission.Split(':', '-').Select(part => char.ToUpperInvariant(part[0]) + part[1..]));
}
