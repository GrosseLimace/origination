// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the Usage Dashboard app-access filter: the dashboard user-set intersection
/// (fail-open semantics) and the Graph UPN → short-name normalization.
/// </summary>
public class AppAccessUserFilterTests
{
    private static HashSet<string> Set(params string[] ids) => new(ids, StringComparer.OrdinalIgnoreCase);

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyAppAccessFilter_NullSet_ReturnsAll_FailOpen()
    {
        var users = Set("CEgr", "JDoe");

        var result = UsageDashboardController.ApplyAppAccessFilter(users, null);

        Assert.Equal(2, result.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyAppAccessFilter_EmptySet_ReturnsAll_FailOpen()
    {
        var users = Set("CEgr", "JDoe");

        var result = UsageDashboardController.ApplyAppAccessFilter(users, Set());

        Assert.Equal(2, result.Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyAppAccessFilter_KeepsOnlyAppUsers_CaseInsensitive()
    {
        var snapshotUsers = Set("CEgr", "JDoe", "ASmith");
        var appAccessUsers = Set("cegr", "asmith"); // different case; JDoe absent

        var result = UsageDashboardController.ApplyAppAccessFilter(snapshotUsers, appAccessUsers);

        Assert.Equal(2, result.Count);
        Assert.Contains("CEgr", result);
        Assert.Contains("ASmith", result);
        Assert.DoesNotContain("JDoe", result);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void ApplyAppAccessFilter_DropsAppUsersNotInSnapshot()
    {
        // A group member with no entitlement/snapshot row is not added (intersection, not union).
        var snapshotUsers = Set("CEgr");
        var appAccessUsers = Set("CEgr", "NewHire");

        var result = UsageDashboardController.ApplyAppAccessFilter(snapshotUsers, appAccessUsers);

        Assert.Equal(new[] { "CEgr" }, result);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData("CEgr@scoular.com", "CEgr")]
    [InlineData("CEgr", "CEgr")]
    [InlineData("", "")]
    public void ToShortName_StripsDomain(string upn, string expected)
    {
        Assert.Equal(expected, AppAccessUserService.ToShortName(upn));
    }
}
