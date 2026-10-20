// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of <see cref="UserPreferenceRepository"/> against an InMemory database: the
/// one-row-per-user upsert behind the trade-unit selection and its UpdatedAt stamp.
/// </summary>
public class UserPreferenceRepositoryTests
{
    private static (UserPreferenceRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"userpref-{Guid.NewGuid()}").Options);
        return (new UserPreferenceRepository(db), db);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByUserAsync_UnknownUser_ReturnsNull()
    {
        var (sut, _) = Build();

        Assert.Null(await sut.GetByUserAsync("cegr", CancellationToken.None));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetAsync_FirstCall_InsertsARowWithBothSelections()
    {
        var (sut, db) = Build();
        var before = DateTime.UtcNow;

        await sut.SetAsync("cegr", "[\"Grain East\"]", "[\"4056\",\"2190\"]", CancellationToken.None);

        var pref = await sut.GetByUserAsync("cegr", CancellationToken.None);
        Assert.NotNull(pref);
        Assert.Equal(("[\"Grain East\"]", "[\"4056\",\"2190\"]"), (pref!.SelectedGroupNames, pref.SelectedTradeUnits));
        Assert.True(pref.UpdatedAt >= before);
        Assert.Equal(1, await db.UserPreferences.CountAsync());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetAsync_SecondCall_OverwritesTheSameRow_AndMovesUpdatedAtForward()
    {
        var (sut, db) = Build();
        db.UserPreferences.Add(new UserPreference
        {
            UserId = "cegr", SelectedGroupNames = "[\"old\"]", SelectedTradeUnits = "[\"1\"]", UpdatedAt = new DateTime(2020, 1, 1)
        });
        await db.SaveChangesAsync();

        await sut.SetAsync("cegr", "[]", "[\"4056\"]", CancellationToken.None);

        var pref = await db.UserPreferences.SingleAsync();                    // still exactly one row
        Assert.Equal(("[]", "[\"4056\"]"), (pref.SelectedGroupNames, pref.SelectedTradeUnits));
        Assert.True(pref.UpdatedAt > new DateTime(2020, 1, 1));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SetAsync_DifferentUsers_KeepSeparateRows()
    {
        var (sut, db) = Build();

        await sut.SetAsync("cegr", "[]", "[\"4056\"]", CancellationToken.None);
        await sut.SetAsync("hcol", "[]", "[\"2190\"]", CancellationToken.None);

        Assert.Equal(2, await db.UserPreferences.CountAsync());
        Assert.Equal("[\"2190\"]", (await sut.GetByUserAsync("hcol", CancellationToken.None))!.SelectedTradeUnits);
    }
}
