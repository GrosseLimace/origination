// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="TeamsChannelRepository"/> against an InMemory database: the
/// display-name ordering of the picker list, the by-id read, and the register-or-refresh rule that
/// keeps a renamed channel's label current without creating a second row for the same ChannelId.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: the lost-insert-race branch in <c>RegisterAsync</c>. It is entered
/// only from a <c>DbUpdateException</c> raised by the unique index on ChannelId, which the InMemory
/// provider never produces.
/// </remarks>
public class TeamsChannelRepositoryTests
{
    private static (TeamsChannelRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"teamschannel-{Guid.NewGuid()}").Options);
        return (new TeamsChannelRepository(db), db);
    }

    private static TeamsChannel Channel(string channelId, string displayName, string teamName = "Grain", string email = "x@teams.ms", string createdBy = "cegr") => new()
    {
        TeamId = "team-1", TeamName = teamName, ChannelId = channelId, DisplayName = displayName, ChannelEmail = email,
        CreatedBy = createdBy, CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAllAsync_OrdersByDisplayName()
    {
        var (sut, db) = Build();
        db.TeamsChannels.AddRange(Channel("c3", "Zulu"), Channel("c1", "Alpha"), Channel("c2", "Mike"));
        await db.SaveChangesAsync();

        var channels = await sut.GetAllAsync(CancellationToken.None);

        Assert.Equal(new[] { "Alpha", "Mike", "Zulu" }, channels.Select(c => c.DisplayName));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByIdAsync_FindsTheRow_OrReturnsNull()
    {
        var (sut, db) = Build();
        db.TeamsChannels.Add(Channel("c1", "Alpha"));
        await db.SaveChangesAsync();
        var id = (await db.TeamsChannels.SingleAsync()).Id;

        Assert.Equal("c1", (await sut.GetByIdAsync(id, CancellationToken.None))!.ChannelId);
        Assert.Null(await sut.GetByIdAsync(id + 1000, CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RegisterAsync_NewChannel_InsertsAndReturnsTheSavedRow()
    {
        var (sut, db) = Build();

        var saved = await sut.RegisterAsync(Channel("c1", "Alpha"), CancellationToken.None);

        Assert.True(saved.Id > 0);
        Assert.Equal(1, await db.TeamsChannels.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RegisterAsync_ExistingChannelId_RefreshesDisplayFieldsOnTheExistingRow()
    {
        var (sut, db) = Build();
        var original = await sut.RegisterAsync(Channel("c1", "Old Name", teamName: "Old Team", email: "old@teams.ms"), CancellationToken.None);

        var result = await sut.RegisterAsync(
            Channel("c1", "New Name", teamName: "New Team", email: "new@teams.ms", createdBy: "someone-else"), CancellationToken.None);

        Assert.Equal(original.Id, result.Id);                                   // same row, not a second registration
        Assert.Equal(("New Name", "New Team", "new@teams.ms"), (result.DisplayName, result.TeamName, result.ChannelEmail));
        Assert.Equal("cegr", result.CreatedBy);                                 // first registrant is kept
        Assert.Equal(1, await db.TeamsChannels.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task RegisterAsync_DifferentChannelIds_AreIndependentRows()
    {
        var (sut, db) = Build();

        await sut.RegisterAsync(Channel("c1", "Alpha"), CancellationToken.None);
        await sut.RegisterAsync(Channel("c2", "Alpha"), CancellationToken.None);   // same display name, different channel

        Assert.Equal(2, await db.TeamsChannels.CountAsync());
    }
}
