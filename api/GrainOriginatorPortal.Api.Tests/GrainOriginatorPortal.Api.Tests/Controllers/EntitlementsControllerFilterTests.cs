// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Covers the daily-digest People picker's app-access filter (the pure helper — the rest of
/// GetCatalog is EF-view plumbing exercised in dev). Entitled-but-no-access people disappear
/// from the picker; an unavailable access set fails open to the unfiltered list.
/// </summary>
public class EntitlementsControllerFilterTests
{
    private static List<EntitlementPerson> People(params string[] userIds) =>
        userIds.Select(id => new EntitlementPerson { UserId = id, DisplayName = id }).ToList();

    [Fact]
    public void AccessAvailable_KeepsOnlyGroupMembers_CaseInsensitive()
    {
        var access = new AppAccessSet
        {
            Available = true,
            ShortNames = new HashSet<string>(["CEgr", "KHague"], StringComparer.OrdinalIgnoreCase)
        };

        var filtered = EntitlementsController.FilterToAppAccess(People("cegr", "KHague", "JNoAccess"), access);

        Assert.Equal(2, filtered.Count);
        Assert.DoesNotContain(filtered, p => p.UserId == "JNoAccess");
    }

    [Fact]
    public void AccessUnavailable_FailsOpen_ReturnsEveryoneUnchanged()
    {
        var people = People("CEgr", "JNoAccess");

        var filtered = EntitlementsController.FilterToAppAccess(people, AppAccessSet.Unavailable);

        Assert.Same(people, filtered); // untouched — pre-existing picker behavior
    }

    [Fact]
    public void AccessAvailable_EmptyGroup_FiltersToEmpty()
    {
        var access = new AppAccessSet { Available = true };

        var filtered = EntitlementsController.FilterToAppAccess(People("CEgr"), access);

        Assert.Empty(filtered);
    }
}
