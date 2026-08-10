// Microsoft namespaces
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Covers the app-access spike endpoint (GET /api/diagnostics/app-access-group-members):
/// config gate, propagation of categorized Graph failures, and the happy path.
/// The other DiagnosticsController routes are environment/DB probes and aren't unit-tested.
/// </summary>
public class DiagnosticsControllerAppAccessTests
{
    private readonly Mock<IGraphDirectoryClient> _graphMock = new();

    private DiagnosticsController CreateSut(string? groupName = "Origination App Dev Users", string? groupId = null)
    {
        var configValues = new Dictionary<string, string?>();
        if (groupName is not null)
            configValues["AppAccess:GroupName"] = groupName;
        if (groupId is not null)
            configValues["AppAccess:GroupId"] = groupId;
        var config = new ConfigurationBuilder().AddInMemoryCollection(configValues).Build();

        var env = new Mock<IWebHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns("Development");

        return new DiagnosticsController(
            new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
                .UseInMemoryDatabase("diag-app-access-ods").Options),
            new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase("diag-app-access-app").Options),
            new EntitlementsDbContext(new DbContextOptionsBuilder<EntitlementsDbContext>()
                .UseInMemoryDatabase("diag-app-access-ent").Options),
            new Mock<ILogger<DiagnosticsController>>().Object,
            env.Object,
            new Mock<IHttpClientFactory>().Object,
            new CustomerSyncService(new Mock<IServiceScopeFactory>().Object, new Mock<ILogger<CustomerSyncService>>().Object),
            _graphMock.Object,
            new Mock<ICtrmGraphQlClient>().Object,
            new CtrmContractSnapshot(
                new Mock<ICtrmGraphQlClient>().Object,
                config,
                new Mock<ILogger<CtrmContractSnapshot>>().Object),
            new Mock<IContractRepository>().Object,
            config);
    }

    private static AppAccessGroupMembersResponse Body(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return Assert.IsType<AppAccessGroupMembersResponse>(ok.Value);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MissingGroupNameConfig_ReturnsNotConfigured_WithoutCallingGraph()
    {
        var sut = CreateSut(groupName: null);

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("NotConfigured", body.Outcome);
        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GroupResolveFailure_PropagatesCategorizedOutcome()
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync("Origination App Dev Users", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.PermissionMissing,
                HttpStatus = 403,
                Detail = "needs GroupMember.Read.All"
            });
        var sut = CreateSut();

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("PermissionMissing", body.Outcome);
        Assert.Equal(403, body.HttpStatus);
        Assert.Contains("GroupMember.Read.All", body.Detail);
        Assert.Empty(body.Members);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MemberReadFailure_PropagatesCategorizedOutcome()
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-1", "Origination App Dev Users")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.EgressBlocked,
                Detail = "needs outbound rule for graph.microsoft.com:443"
            });
        var sut = CreateSut();

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("EgressBlocked", body.Outcome);
        Assert.Contains("outbound rule", body.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GroupIdConfigured_UsesDirectRead_NeverSearchesByName()
    {
        _graphMock.Setup(g => g.GetGroupByIdAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-direct", "Origination App Dev Users")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value = [new GraphUser("1", "Caden Egr", "CEgr@scoular.com", true)]
            });
        var sut = CreateSut(groupName: null, groupId: "gid-direct");

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("Ok", body.Outcome);
        Assert.Equal("Origination App Dev Users", body.GroupName); // label from the direct read
        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AllMembersIdOnly_ReportsMembersIdOnly_NamingTheMissingPermission()
    {
        _graphMock.Setup(g => g.GetGroupByIdAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-direct", "Origination App Dev Users")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value = [new GraphUser("1", null, null, null), new GraphUser("2", null, null, null)]
            });
        var sut = CreateSut(groupName: null, groupId: "gid-direct");

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("MembersIdOnly", body.Outcome);
        Assert.Equal(2, body.MemberCount);
        Assert.Contains("User.ReadBasic.All", body.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Success_ReturnsMembersSortedByDisplayName_WithCount()
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync("Origination App Dev Users", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-1", "Origination App Dev Users")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value =
                [
                    new GraphUser("2", "Zeke Z", "ZekeZ@scoular.com", true),
                    new GraphUser("1", "Ann A", "AnnA@scoular.com", false)
                ]
            });
        var sut = CreateSut();

        var body = Body(await sut.GetAppAccessGroupMembers());

        Assert.Equal("Ok", body.Outcome);
        Assert.Equal(2, body.MemberCount);
        Assert.Equal("Ann A", body.Members[0].DisplayName);   // sorted
        Assert.Equal("Zeke Z", body.Members[1].DisplayName);
        Assert.False(body.Members[0].AccountEnabled);          // disabled flag surfaced, not hidden
    }
}
