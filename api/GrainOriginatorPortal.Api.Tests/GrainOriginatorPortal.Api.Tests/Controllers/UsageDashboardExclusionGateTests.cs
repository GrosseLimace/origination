// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The exclusion-list endpoints are restricted to the configured
/// UsageDashboard:ExclusionManagers allowlist — a tighter circle than the Admin role that gates the
/// rest of the dashboard. These tests pin that gate: allowlisted callers get through, other admins
/// get 403, and /can-manage reports the flag the client uses to hide the gear.
/// </summary>
public class UsageDashboardExclusionGateTests
{
    private readonly Mock<IUsageDashboardService> _serviceMock = new();

    private UsageDashboardController CreateController(string signedInShortName, params string[] allowlist)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(allowlist
                .Select((name, i) => new KeyValuePair<string, string?>($"UsageDashboard:ExclusionManagers:{i}", name)))
            .Build();

        var controller = new UsageDashboardController(_serviceMock.Object, config)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim("preferred_username", $"{signedInShortName}@scoular.com")], "TestAuth"))
                }
            }
        };
        return controller;
    }

    [Theory]
    [InlineData("CEgr")]
    [InlineData("admin-CEgr")]
    [InlineData("HCollins")]
    [InlineData("admin-HCollins")]
    public void CanManage_ReportsTrue_ForAllowlistedManagers(string shortName)
    {
        var controller = CreateController(shortName, "CEgr", "admin-CEgr", "HCollins", "admin-HCollins");

        var result = Assert.IsType<OkObjectResult>(controller.GetCanManageExclusions().Result);
        var dto = Assert.IsType<ExclusionPermissionsDto>(result.Value);
        Assert.True(dto.CanManage);
    }

    [Fact]
    public void CanManage_ReportsFalse_ForAnAdminWhoIsNotOnTheAllowlist()
    {
        var controller = CreateController("KHague", "CEgr", "admin-CEgr", "HCollins", "admin-HCollins");

        var result = Assert.IsType<OkObjectResult>(controller.GetCanManageExclusions().Result);
        var dto = Assert.IsType<ExclusionPermissionsDto>(result.Value);
        Assert.False(dto.CanManage);
    }

    [Fact]
    public async Task ExclusionEndpoints_Forbid_ANonManagerAdmin()
    {
        var controller = CreateController("KHague", "CEgr", "HCollins");

        Assert.IsType<ForbidResult>((await controller.GetExcludedUsers(CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.GetAccessUsers(CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.AddExcludedUser(
            new AddExcludedUserRequest { UserId = "someone" }, CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>(await controller.RemoveExcludedUser(1, CancellationToken.None));

        // The gate rejected before any data work happened.
        _serviceMock.Verify(s => s.GetExcludedUsersAsync(It.IsAny<CancellationToken>()), Times.Never);
        _serviceMock.Verify(s => s.RemoveExcludedUserAsync(It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ExclusionEndpoints_AllowAManager_CaseInsensitively()
    {
        _serviceMock.Setup(s => s.GetExcludedUsersAsync(It.IsAny<CancellationToken>())).ReturnsAsync([]);
        var controller = CreateController("cegr", "CEgr", "HCollins"); // token casing differs from config

        var result = await controller.GetExcludedUsers(CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task ExclusionEndpoints_Forbid_WhenNoAllowlistIsConfigured()
    {
        // Empty allowlist fails closed — nobody manages exclusions until the config names someone.
        var controller = CreateController("CEgr" /* no allowlist entries */);

        Assert.IsType<ForbidResult>((await controller.GetExcludedUsers(CancellationToken.None)).Result);
    }
}
