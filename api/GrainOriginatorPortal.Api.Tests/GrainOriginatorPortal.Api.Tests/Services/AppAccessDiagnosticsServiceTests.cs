// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Api.Services.Diagnostics;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The outcome matrix of the app-access probe is pinned through the controller in
/// DiagnosticsControllerAppAccessTests (unchanged by the extraction). This covers what only the
/// service can show: the success log line, the mixed id-only detail, and that the config read
/// trims whitespace before deciding the group lookup path.
/// </summary>
public class AppAccessDiagnosticsServiceTests
{
    private readonly Mock<IGraphDirectoryClient> _graph = new();
    private readonly CapturingLogger<AppAccessDiagnosticsService> _logger = new();

    private AppAccessDiagnosticsService CreateSut(string? groupName = null, string? groupId = null)
    {
        var values = new Dictionary<string, string?>();
        if (groupName is not null) values["AppAccess:GroupName"] = groupName;
        if (groupId is not null) values["AppAccess:GroupId"] = groupId;
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        return new AppAccessDiagnosticsService(_graph.Object, config, _logger);
    }

    private void GroupResolves(string id) =>
        _graph.Setup(g => g.GetGroupByIdAsync(id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef> { Status = GraphReadStatus.Ok, Value = new GraphGroupRef(id, "App Users") });

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Success_LogsTheMemberCount_AndNothingElse()
    {
        GroupResolves("gid");
        _graph.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value = [new GraphUser("1", "Ann A", "AnnA@scoular.com", true), new GraphUser("2", "Bob B", "BobB@scoular.com", true)]
            });

        var result = await CreateSut(groupId: "gid").GetGroupMembersAsync(CancellationToken.None);

        Assert.Equal("Ok", result.Outcome);
        Assert.Null(result.Detail);
        var entry = Assert.Single(_logger.Entries);
        Assert.Equal(LogLevel.Information, entry.Level);
        Assert.Equal("App-access group read OK: 2 members", entry.Message);
        Assert.Equal(2, entry.Fields["MemberCount"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SomeMembersIdOnly_StillOk_ButDetailNamesTheExcludedCount()
    {
        GroupResolves("gid");
        _graph.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value = [new GraphUser("1", "Ann A", "AnnA@scoular.com", true), new GraphUser("2", null, null, null), new GraphUser("3", null, null, null)]
            });

        var result = await CreateSut(groupId: "gid").GetGroupMembersAsync(CancellationToken.None);

        Assert.Equal("Ok", result.Outcome);
        Assert.Equal(3, result.MemberCount);
        Assert.Equal("2 of 3 members returned id-only (no UPN) and are excluded from matching.", result.Detail);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ConfigValuesAreTrimmed_AndGroupIdWinsOverGroupName()
    {
        GroupResolves("gid");
        _graph.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>> { Status = GraphReadStatus.Ok, Value = [] });

        var result = await CreateSut(groupName: "  Some Name  ", groupId: "  gid  ").GetGroupMembersAsync(CancellationToken.None);

        Assert.Equal("Ok", result.Outcome);
        Assert.Equal("App Users", result.GroupName);
        _graph.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task WhitespaceOnlyConfig_IsNotConfigured()
    {
        var result = await CreateSut(groupName: "   ", groupId: "  ").GetGroupMembersAsync(CancellationToken.None);

        Assert.Equal("NotConfigured", result.Outcome);
        Assert.Empty(_logger.Entries);
        _graph.VerifyNoOtherCalls();
    }
}
