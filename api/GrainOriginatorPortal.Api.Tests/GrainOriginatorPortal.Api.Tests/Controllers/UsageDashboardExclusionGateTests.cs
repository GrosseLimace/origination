// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// The exclusion-list endpoints require usage-exclusions:manage, which reading the dashboard doesn't grant.
/// /excluded-users/can-manage reports whether the caller holds it, and the client hides the gear when it
/// doesn't. Which permission each endpoint requires is pinned in ControllerAuthorizationTests.
/// </summary>
public class UsageDashboardExclusionGateTests
{
    private readonly Mock<IUsageDashboardService> _service = new();
    private readonly Mock<IPermissionService> _permissions = new();

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CanManage_ReportsWhetherTheCallerHoldsUsageExclusionsManage(bool holds)
    {
        _permissions
            .Setup(p => p.HasPermissionAsync(AppPermissions.UsageAnalytics.UsageExclusionsManage, It.IsAny<CancellationToken>()))
            .ReturnsAsync(holds);
        var controller = new UsageDashboardController(_service.Object, _permissions.Object);

        var result = await controller.GetCanManageExclusions(CancellationToken.None);

        var dto = Assert.IsType<ExclusionPermissionsDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(holds, dto.CanManage);
    }
}
