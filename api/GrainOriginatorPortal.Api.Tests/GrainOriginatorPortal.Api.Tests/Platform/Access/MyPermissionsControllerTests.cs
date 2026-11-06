// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Platform.Access.Controllers;
using GrainOriginatorPortal.Api.Platform.Access.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Platform.Access;

public class MyPermissionsControllerTests
{
    [Fact]
    public async Task ReturnsTheCallersAccess_Sorted_UnderTheirSignInName()
    {
        var permissions = Substitute.For<IPermissionService>();
        permissions.GetAccessAsync(Arg.Any<CancellationToken>()).Returns(new UserAccess(
            Set("Originator", "Editor"),
            Set("notes:write", "customers:read", "notes:read"),
            Set("Producer"),
            Set("engagement", "customers"),
            UsesDefaultRoles: true));
        var controller = new MyPermissionsController(permissions)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = TestUsers.Person() } },
        };

        var result = await controller.Get(CancellationToken.None);

        var body = Assert.IsType<MyPermissionsResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("jane.doe@example.com", body.UserId);
        Assert.Equal(new[] { "Editor", "Originator" }, body.Roles);
        Assert.Equal(new[] { "customers:read", "notes:read", "notes:write" }, body.Permissions);
        Assert.Equal(new[] { "customers", "engagement" }, body.Modules);
        Assert.Equal(new[] { "Producer" }, body.Segments);
    }

    [Fact]
    public void NeedsOnlyASignIn_NoPermission()
    {
        // Everyone signed in must be able to ask what they may do. A permission here would leave the client
        // unable to load, so it could never show a user why they were refused.
        var onClass = typeof(MyPermissionsController).GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true)
            .Cast<AuthorizeAttribute>()
            .ToArray();
        var onAction = typeof(MyPermissionsController).GetMethod(nameof(MyPermissionsController.Get))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true);

        Assert.NotEmpty(onClass);
        Assert.All(onClass, a => Assert.Null(a.Policy));
        Assert.Empty(onAction);
    }

    private static HashSet<string> Set(params string[] values) => [.. values];
}
