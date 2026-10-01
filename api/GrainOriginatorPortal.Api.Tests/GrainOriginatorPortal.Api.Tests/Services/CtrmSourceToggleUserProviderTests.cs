// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The tester table read: active rows only, case-insensitive, cached, and failing closed.
/// </summary>
public class CtrmSourceToggleUserProviderTests
{
    private static ApplicationDbContext Db() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase($"toggle-{Guid.NewGuid()}").Options);

    private static CtrmSourceToggleUserProvider Sut(ApplicationDbContext db, IMemoryCache? cache = null) =>
        new(db, cache ?? new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }), new Mock<ILogger<CtrmSourceToggleUserProvider>>().Object);

    [Fact]
    public async Task ReturnsActiveUsersOnly_TrimmedAndCaseInsensitive()
    {
        using var db = Db();
        db.CtrmSourceToggleUsers.AddRange(
            new CtrmSourceToggleUser { UserId = " CEgr@scoular.com ", DisplayName = "Caden Egr", IsActive = true },
            new CtrmSourceToggleUser { UserId = "old@scoular.com", IsActive = false },
            new CtrmSourceToggleUser { UserId = "HCollins@scoular.com", IsActive = true });
        await db.SaveChangesAsync();

        var set = await Sut(db).GetAsync(CancellationToken.None);

        Assert.Equal(2, set.Count);
        Assert.Contains("cegr@scoular.com", set);          // trimmed, and the set compares case-insensitively
        Assert.Contains("hcollins@SCOULAR.com", set);
        Assert.DoesNotContain("old@scoular.com", set);     // switched off, not deleted
    }

    [Fact]
    public async Task TheReadIsCached_SoARequestPerSecondDoesNotBecomeAQueryPerSecond()
    {
        using var db = Db();
        db.CtrmSourceToggleUsers.Add(new CtrmSourceToggleUser { UserId = "CEgr@scoular.com" });
        await db.SaveChangesAsync();
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var sut = Sut(db, cache);

        var first = await sut.GetAsync(CancellationToken.None);

        // A row added after the first read is not visible until the cache entry expires.
        db.CtrmSourceToggleUsers.Add(new CtrmSourceToggleUser { UserId = "new@scoular.com" });
        await db.SaveChangesAsync();
        var second = await sut.GetAsync(CancellationToken.None);

        Assert.Same(first, second);
        Assert.Single(second);
    }

    [Fact]
    public async Task AnUnreadableTable_FailsClosedToNobody()
    {
        // A context whose underlying store throws stands in for an unreachable database.
        var db = Db();
        await db.DisposeAsync();   // any query now throws ObjectDisposedException

        var set = await Sut(db).GetAsync(CancellationToken.None);

        Assert.Empty(set);
    }
}
