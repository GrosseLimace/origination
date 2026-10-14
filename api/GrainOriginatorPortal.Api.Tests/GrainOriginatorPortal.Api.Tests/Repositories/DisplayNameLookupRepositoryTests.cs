// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="DisplayNameLookupRepository"/> against an InMemory database: the
/// short-form (left of '@') match against the trade-unit snapshot, the re-registration of every
/// full-UPN spelling the caller passed, and the blank / unknown / duplicate handling.
/// </summary>
public class DisplayNameLookupRepositoryTests
{
    private static (DisplayNameLookupRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"displayname-{Guid.NewGuid()}").Options);
        return (new DisplayNameLookupRepository(db), db);
    }

    private static UserTradeUnitSnapshot Snapshot(string user, string displayName, string tradeUnit = "4056") => new()
    {
        UserId = user, DisplayName = displayName, TradeUnitCode = tradeUnit, SnapshotDate = new DateOnly(2026, 1, 1)
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveAsync_MapsShortFormAndEveryFullUpnSpellingPassedIn()
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.AddRange(Snapshot("CEgr", "Caden Egr"), Snapshot("CEgr", "Caden Egr", tradeUnit: "2190"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(["CEgr@scoular.com", "cegr@scoular.com", "CEgr"], CancellationToken.None);

        Assert.Equal("Caden Egr", map["CEgr"]);
        Assert.Equal("Caden Egr", map["CEgr@scoular.com"]);
        Assert.Equal("Caden Egr", map["cegr@scoular.com"]);
        Assert.Equal("Caden Egr", map["CEGR@SCOULAR.COM"]);          // the map itself is case-insensitive
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveAsync_UnknownUsersAreSimplyAbsent()
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.Add(Snapshot("CEgr", "Caden Egr"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(["CEgr@scoular.com", "nobody@scoular.com"], CancellationToken.None);

        Assert.Equal(new[] { "CEgr", "CEgr@scoular.com" }, map.Keys.OrderBy(k => k));
        Assert.False(map.ContainsKey("nobody@scoular.com"));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(new object[] { new string[0] })]
    [InlineData(new object[] { new[] { "", "" } })]
    public async Task ResolveAsync_NoUsableIds_ReturnsEmptyCaseInsensitiveMap(string[] ids)
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.Add(Snapshot("CEgr", "Caden Egr"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(ids, CancellationToken.None);

        Assert.Empty(map);
        Assert.Equal(StringComparer.OrdinalIgnoreCase, map.Comparer);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveAsync_BlankEntriesAreSkipped_WithoutDroppingTheRest()
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.Add(Snapshot("HCol", "Holly Collins"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(["", "HCol@scoular.com"], CancellationToken.None);

        Assert.Equal(new[] { "HCol", "HCol@scoular.com" }, map.Keys.OrderBy(k => k));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveAsync_IdWithoutAnAt_IsUsedAsTheShortFormItself()
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.Add(Snapshot("HCol", "Holly Collins"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(["HCol"], CancellationToken.None);

        Assert.Equal(new[] { "HCol" }, map.Keys);
        Assert.Equal("Holly Collins", map["HCol"]);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task ResolveAsync_LeadingAtIsNotTreatedAsASeparator()
    {
        var (sut, db) = Build();
        db.UserTradeUnitSnapshots.Add(Snapshot("@weird", "Weird Name"));
        await db.SaveChangesAsync();

        var map = await sut.ResolveAsync(["@weird"], CancellationToken.None);

        Assert.Equal("Weird Name", map["@weird"]);   // IndexOf('@') == 0 is not a split point, so the whole id is the short form
    }
}
