// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

public class AppAccessServiceTests
{
    private readonly Mock<IGraphDirectoryClient> _graphMock = new();
    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 100 });

    private AppAccessService CreateSut(string? groupName = "Origination App Dev Users", string? groupId = null)
    {
        var values = new Dictionary<string, string?> { ["AppAccess:CacheMinutes"] = "30" };
        if (groupName is not null)
            values["AppAccess:GroupName"] = groupName;
        if (groupId is not null)
            values["AppAccess:GroupId"] = groupId;
        var config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        return new AppAccessService(_graphMock.Object, config, _cache, new Mock<ILogger<AppAccessService>>().Object);
    }

    private void SetupHappyGraph(params GraphUser[] users)
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync("Origination App Dev Users", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-1", "Origination App Dev Users")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>> { Status = GraphReadStatus.Ok, Value = [.. users] });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Success_BuildsShortNameSet_SkippingDisabledAndUpnLessAccounts()
    {
        SetupHappyGraph(
            new GraphUser("1", "Caden Egr", "CEgr@scoular.com", true),
            new GraphUser("2", "Karl Hague", "KHague@scoular.com", null),        // unknown enabled → counts
            new GraphUser("3", "Old Account", "Old@scoular.com", false),         // disabled → excluded
            new GraphUser("4", "No Upn", null, true));                           // no UPN → excluded

        var result = await CreateSut().GetAccessSetAsync(CancellationToken.None);

        Assert.True(result.Available);
        Assert.Equal(2, result.ShortNames.Count);
        Assert.Contains("CEgr", result.ShortNames);
        Assert.Contains("cegr", result.ShortNames);   // case-insensitive
        Assert.Contains("KHague", result.ShortNames);
        Assert.DoesNotContain("Old", result.ShortNames);
        Assert.Equal("Caden Egr", result.DisplayNames["CEgr"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task Success_IsCached_SecondCallMakesNoGraphCalls()
    {
        SetupHappyGraph(new GraphUser("1", "Caden Egr", "CEgr@scoular.com", true));
        var sut = CreateSut();

        await sut.GetAccessSetAsync(CancellationToken.None);
        await sut.GetAccessSetAsync(CancellationToken.None);

        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
        _graphMock.Verify(g => g.GetGroupTransitiveUserMembersAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GraphFailure_ReturnsUnavailable_AndCachesTheFailure()
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.EgressBlocked,
                Detail = "NSG"
            });
        var sut = CreateSut();

        var first = await sut.GetAccessSetAsync(CancellationToken.None);
        var second = await sut.GetAccessSetAsync(CancellationToken.None);

        Assert.False(first.Available);
        Assert.False(second.Available);
        // Failure is cached — a blocked Graph isn't re-hit on every dashboard request.
        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MemberReadFailure_ReturnsUnavailable()
    {
        _graphMock.Setup(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<GraphGroupRef>
            {
                Status = GraphReadStatus.Ok,
                Value = new GraphGroupRef("gid-1", "x")
            });
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-1", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>> { Status = GraphReadStatus.PermissionMissing, HttpStatus = 403 });

        var result = await CreateSut().GetAccessSetAsync(CancellationToken.None);

        Assert.False(result.Available);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task MissingGroupConfig_ReturnsUnavailable_WithoutCallingGraph()
    {
        var result = await CreateSut(groupName: null).GetAccessSetAsync(CancellationToken.None);

        Assert.False(result.Available);
        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GroupIdConfigured_ReadsMembersDirectly_NeverSearchesByName()
    {
        // The scoped managed identity cannot list/search groups — a configured id must skip
        // straight to the member read.
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value = [new GraphUser("1", "Caden Egr", "CEgr@scoular.com", true)]
            });

        var result = await CreateSut(groupId: "gid-direct").GetAccessSetAsync(CancellationToken.None);

        Assert.True(result.Available);
        Assert.Contains("CEgr", result.ShortNames);
        _graphMock.Verify(g => g.FindGroupByNameAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _graphMock.Verify(g => g.GetGroupByIdAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task IdOnlyMembers_FailsOpen_InsteadOfHidingEveryUser()
    {
        // Group read granted but User.ReadBasic.All missing: Graph returns members with ids only.
        // An "available but empty" set would filter every user out of the dashboards — must be
        // treated as unavailable (fail open).
        _graphMock.Setup(g => g.GetGroupTransitiveUserMembersAsync("gid-direct", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new GraphReadResult<List<GraphUser>>
            {
                Status = GraphReadStatus.Ok,
                Value =
                [
                    new GraphUser("1", null, null, null),
                    new GraphUser("2", null, null, null)
                ]
            });

        var result = await CreateSut(groupId: "gid-direct").GetAccessSetAsync(CancellationToken.None);

        Assert.False(result.Available);
        Assert.Empty(result.ShortNames);
    }
}
