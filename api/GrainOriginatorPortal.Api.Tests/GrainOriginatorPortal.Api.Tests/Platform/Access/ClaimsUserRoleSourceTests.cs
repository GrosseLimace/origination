// System namespaces
using System.Security.Claims;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

public class ClaimsUserRoleSourceTests
{
    private readonly ClaimsUserRoleSource _source = new();

    [Fact]
    public void ReadsRoles_UnderEveryClaimNameTheyArriveAs()
    {
        // Microsoft.Identity.Web uses "roles"; inbound claim mapping can produce ClaimTypes.Role; an
        // identity can also name its own role claim type.
        var identity = new ClaimsIdentity(
            [new Claim("roles", "Originator"), new Claim(ClaimTypes.Role, "Editor"), new Claim("app_roles", "Manager")],
            authenticationType: "Bearer", nameType: "name", roleType: "app_roles");

        var roles = _source.GetRoles(new ClaimsPrincipal(identity));

        Assert.Equal(new[] { "Editor", "Manager", "Originator" }, roles.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void ComparesRoles_WithoutRegardToCase_AndIgnoresBlanks()
    {
        var roles = _source.GetRoles(TestUsers.Person("Editor", "editor", " ", " Manager "));

        Assert.Equal(2, roles.Count);
        Assert.Contains("EDITOR", roles);
        Assert.Contains("Manager", roles);
    }

    [Fact]
    public void AnonymousCaller_HasNoRoles()
    {
        var anonymousWithRoleClaim = new ClaimsPrincipal(new ClaimsIdentity([new Claim("roles", "Admin")]));

        Assert.Empty(_source.GetRoles(anonymousWithRoleClaim));
    }
}
