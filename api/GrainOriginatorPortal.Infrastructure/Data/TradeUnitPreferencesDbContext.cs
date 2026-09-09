using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Read-only DbContext for the TradeUnitPreferences database.
/// No migrations or writes are performed against this context — every entity is keyless so a write
/// can't be attempted by accident, including the one base table mapped here (dbo.Users).
///
/// Replaced EntitlementsDbContext (2026-08-18). Trade-unit assignment moved to a dedicated
/// application where managers add users and assign trade units; this app reads the result and never
/// writes it. Column-for-column identical to the old vw_UserTradeUnitAccess, so nothing downstream
/// of this context had to change.
/// </summary>
public class TradeUnitPreferencesDbContext : DbContext
{
    public TradeUnitPreferencesDbContext(DbContextOptions<TradeUnitPreferencesDbContext> options)
        : base(options)
    {
    }

    public DbSet<UserTradeUnitPreference> UserTradeUnitPreferences => Set<UserTradeUnitPreference>();

    public DbSet<TradeUnitPreferencesUser> Users => Set<TradeUnitPreferencesUser>();

    public DbSet<UserManagerLookup> UserManagerLookups => Set<UserManagerLookup>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<UserTradeUnitPreference>(entity =>
        {
            entity.ToView("vw_UserTradeUnitPreferences", schema: "dbo");
            entity.HasNoKey();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(50);
            entity.Property(e => e.DisplayName).HasColumnName("DisplayName").HasMaxLength(200);
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(20);
            entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(500);
            entity.Property(e => e.AssignmentSource).HasColumnName("AssignmentSource").HasMaxLength(50);
            entity.Property(e => e.GroupId).HasColumnName("GroupId");
            entity.Property(e => e.GroupName).HasColumnName("GroupName").HasMaxLength(200);
        });

        modelBuilder.Entity<TradeUnitPreferencesUser>(entity =>
        {
            entity.ToTable("Users", schema: "dbo");
            entity.HasNoKey();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(50);
            entity.Property(e => e.DisplayName).HasColumnName("DisplayName").HasMaxLength(200);
            entity.Property(e => e.IsActive).HasColumnName("IsActive");
        });

        modelBuilder.Entity<UserManagerLookup>(entity =>
        {
            entity.ToView("vw_UserManagerLookup", schema: "dbo");
            entity.HasNoKey();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(50);
            entity.Property(e => e.DisplayName).HasColumnName("DisplayName").HasMaxLength(200);
            entity.Property(e => e.HierId).HasColumnName("HierID").HasMaxLength(100);
            entity.Property(e => e.IsManager).HasColumnName("IsManager");
            entity.Property(e => e.ManagerUserId).HasColumnName("ManagerUserId").HasMaxLength(50);
            entity.Property(e => e.ManagerDisplayName).HasColumnName("ManagerDisplayName").HasMaxLength(200);
            entity.Property(e => e.ManagerHierId).HasColumnName("ManagerHierID").HasMaxLength(100);
        });
    }
}
