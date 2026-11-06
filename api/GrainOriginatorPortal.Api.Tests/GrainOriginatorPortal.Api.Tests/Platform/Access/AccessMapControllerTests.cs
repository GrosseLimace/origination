// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Platform.Access.Controllers;
using GrainOriginatorPortal.Api.Platform.Access.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

public class AccessMapControllerTests
{
    private const string NotesRead = AppPermissions.Engagement.NotesRead;
    private const string NotesWrite = AppPermissions.Engagement.NotesWrite;
    private const string DiagnosticsRead = AppPermissions.Platform.DiagnosticsRead;

    private static async Task<AccessMapResponse> GetAsync(AccessGrants grants, AccessOptions? options = null, string environmentName = "QA")
    {
        var cache = Substitute.For<IRoleGrantCache>();
        cache.GetAsync(Arg.Any<CancellationToken>()).Returns(grants);
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(environmentName);
        var controller = new AccessMapController(cache, new FixedOptionsMonitor<AccessOptions>(options ?? new AccessOptions()), environment);

        var result = await controller.Get(CancellationToken.None);

        return Assert.IsType<AccessMapResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task ListsEveryRole_ByName_WithItsGrantsSorted()
    {
        var map = await GetAsync(TestGrants.Map());

        Assert.Equal(new[] { "Admin", "Editor", "Manager", "Originator", "Support" }, map.Roles.Select(r => r.Name));
        var originator = map.Roles.Single(r => r.Name == "Originator");
        Assert.Equal(RoleKind.Persona, originator.Kind);
        Assert.False(originator.IsSystem);
        Assert.Equal(TestGrants.Originator.Permissions.Order(StringComparer.Ordinal), originator.Permissions);
        Assert.Equal(new[] { CustomerSegments.Producer }, originator.Segments);
        Assert.True(map.Roles.Single(r => r.Name == "Admin").IsSystem);
    }

    [Fact]
    public async Task FlagsPermissionsNoRoleHolds_AndThoseOnlyTheSystemRoleHolds()
    {
        var map = await GetAsync(TestGrants.Map(
            TestGrants.Role("Admin", RoleKind.Base, isSystem: true, [NotesRead, NotesWrite, DiagnosticsRead], []),
            TestGrants.Role("Originator", RoleKind.Persona, isSystem: false, [NotesRead], [])));

        Assert.Equal(new[] { DiagnosticsRead, NotesWrite }, map.HeldOnlyBySystemRoles);
        Assert.Equal(AppPermissions.All.Except([NotesRead, NotesWrite, DiagnosticsRead]), map.HeldByNoRole);
    }

    [Fact]
    public async Task ShowsTheEnvironment_AndTheDefaultRolesItGives()
    {
        var map = await GetAsync(TestGrants.Map(), new AccessOptions { DefaultRoles = ["Originator", "Editor"] }, "Production");

        Assert.Equal("Production", map.Environment);
        Assert.Equal(new[] { "Originator", "Editor" }, map.DefaultRoles);
    }

    [Fact]
    public void RequiresDiagnosticsRead()
    {
        var required = typeof(AccessMapController)
            .GetCustomAttributes(typeof(RequirePermissionAttribute), inherit: true)
            .Cast<RequirePermissionAttribute>();

        Assert.Equal(DiagnosticsRead, Assert.Single(required).Permission);
    }
}
