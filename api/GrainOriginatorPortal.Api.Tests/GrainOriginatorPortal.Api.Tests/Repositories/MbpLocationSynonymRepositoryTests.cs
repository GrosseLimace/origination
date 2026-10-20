// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="MbpLocationSynonymRepository"/> against an InMemory database: the
/// LocationId → DisplayName lookup, trimming on both the requested ids and the stored values, and the
/// exclusion of rows that carry no display name.
/// </summary>
public class MbpLocationSynonymRepositoryTests
{
    private static (MbpLocationSynonymRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"mbpsyn-{Guid.NewGuid()}").Options);
        return (new MbpLocationSynonymRepository(db), db);
    }

    private static MbpLocationSynonym Row(int id, string locationId, string? displayName) => new()
    {
        Id = id, LocationId = locationId, DisplayName = displayName
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetDisplayNames_ResolvesRequestedIds_TrimmingBothSides()
    {
        var (sut, db) = Build();
        db.MbpLocationSynonyms.AddRange(
            Row(1, "1075-MADRID", "  Madrid, NE  "),
            Row(2, "1075-LINCOLN", "Lincoln, NE"),
            Row(3, "1075-OMAHA", "Omaha, NE"));           // not requested
        await db.SaveChangesAsync();

        var map = await sut.GetDisplayNamesByLocationIdsAsync(["  1075-MADRID ", "1075-LINCOLN", "1075-LINCOLN"], CancellationToken.None);

        Assert.Equal(2, map.Count);
        Assert.Equal("Madrid, NE", map["1075-MADRID"]);
        Assert.Equal("Lincoln, NE", map["1075-lincoln"]);     // case-insensitive map for the caller
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetDisplayNames_RowsWithNoDisplayName_AreLeftOut()
    {
        var (sut, db) = Build();
        db.MbpLocationSynonyms.AddRange(Row(1, "A", null), Row(2, "B", "   "), Row(3, "C", "City, ST"));
        await db.SaveChangesAsync();

        var map = await sut.GetDisplayNamesByLocationIdsAsync(["A", "B", "C"], CancellationToken.None);

        Assert.Equal(new[] { "C" }, map.Keys);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(new object[] { new string[0] })]
    [InlineData(new object[] { new[] { "", "   " } })]
    public async Task GetDisplayNames_NoUsableIds_ReturnsEmptyWithoutQuerying(string[] ids)
    {
        var (sut, db) = Build();
        db.MbpLocationSynonyms.Add(Row(1, "A", "City, ST"));
        await db.SaveChangesAsync();

        var map = await sut.GetDisplayNamesByLocationIdsAsync(ids, CancellationToken.None);

        Assert.Empty(map);
        Assert.Equal(StringComparer.OrdinalIgnoreCase, map.Comparer);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetDisplayNames_UnmatchedIds_AreAbsentRatherThanBlank()
    {
        var (sut, db) = Build();
        db.MbpLocationSynonyms.Add(Row(1, "A", "City, ST"));
        await db.SaveChangesAsync();

        var map = await sut.GetDisplayNamesByLocationIdsAsync(["A", "ZZZ"], CancellationToken.None);

        Assert.False(map.ContainsKey("ZZZ"));
        Assert.Single(map);
    }
}
