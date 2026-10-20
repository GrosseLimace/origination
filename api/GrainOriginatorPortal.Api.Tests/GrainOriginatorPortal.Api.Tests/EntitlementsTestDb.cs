using Microsoft.EntityFrameworkCore;

using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>An in-memory TradeUnitPreferences database that a test can seed.</summary>
public static class EntitlementsTestDb
{
    /// <summary>One row of vw_UserTradeUnitPreferences.</summary>
    public sealed record Assignment(
        string UserId, string DisplayName, string TradeUnitCode, string? Description = null,
        int? GroupId = null, string? GroupName = null);

    /// <summary>The real context maps both entities keyless and read-only (it never writes), which
    /// the in-memory provider can't seed. This subclass adds keys purely so a test can arrange rows;
    /// every query under test runs against the inherited model unchanged.</summary>
    private sealed class SeedableContext(DbContextOptions<TradeUnitPreferencesDbContext> options)
        : TradeUnitPreferencesDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Entity<UserTradeUnitPreference>(e =>
            {
                e.ToTable("UserTradeUnitPreferences");
                e.HasKey(x => new { x.UserId, x.TradeUnitCode });
            });
            modelBuilder.Entity<TradeUnitPreferencesUser>(e =>
            {
                e.ToTable("Users");
                e.HasKey(x => x.UserId);
            });
        }
    }

    public static TradeUnitPreferencesDbContext Create(string name)
        => new SeedableContext(new DbContextOptionsBuilder<TradeUnitPreferencesDbContext>()
            .UseInMemoryDatabase(name).Options);

    public static void Seed(TradeUnitPreferencesDbContext db, Assignment[] assignments, (string UserId, bool IsActive)[] roster)
    {
        db.UserTradeUnitPreferences.AddRange(assignments.Select(a => new UserTradeUnitPreference
        {
            UserId = a.UserId,
            DisplayName = a.DisplayName,
            TradeUnitCode = a.TradeUnitCode,
            Description = a.Description,
            GroupId = a.GroupId,
            GroupName = a.GroupName,
        }));
        db.Users.AddRange(roster.Select(u => new TradeUnitPreferencesUser
        {
            UserId = u.UserId,
            DisplayName = u.UserId,
            IsActive = u.IsActive,
        }));
        db.SaveChanges();
    }

    /// <summary>
    /// A small directory that exercises every rule the two catalogs apply. The caller (CEgr) is in
    /// trade units 1084 and 2001, and through group 7 ("North Group"), which also covers 3003.
    /// <list type="bullet">
    /// <item>alice and bob each share one of the caller's trade units.</item>
    /// <item>bob's display name is lower case, which tests the ordering.</item>
    /// <item>lena shares 1084 but is deactivated in the roster.</item>
    /// <item>gus and carl are only in 3003. gus reaches it through group 7, carl directly.</item>
    /// </list>
    /// </summary>
    public static void SeedDirectory(TradeUnitPreferencesDbContext db) => Seed(db,
        assignments:
        [
            new("CEgr", "Caden Egr", "1084", "Kansas", 7, "North Group"),
            new("CEgr", "Caden Egr", "2001", "Nebraska"),
            new("alice", "Alice Adams", "1084", "Kansas"),
            new("bob", "bob Brown", "2001", "Nebraska"),
            new("lena", "Lena Left", "1084", "Kansas"),
            new("gus", "Gus Green", "3003", "Iowa", 7, "North Group"),
            new("carl", "Carl Cole", "3003", "Iowa"),
        ],
        roster: [("CEgr", true), ("alice", true), ("bob", true), ("lena", false), ("gus", true), ("carl", true)]);
}
