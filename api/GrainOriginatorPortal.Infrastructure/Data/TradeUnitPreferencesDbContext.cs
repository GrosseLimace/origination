using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Read-only DbContext for the TradeUnitPreferences database.
/// Only maps views — no migrations or writes are performed against this context.
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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<UserTradeUnitPreference>(entity =>
        {
            entity.ToView("vw_UserTradeUnitPreferences", schema: "dbo");
            entity.HasNoKey();
            entity.Property(e => e.UserId).HasColumnName("UserId").HasMaxLength(100);
            entity.Property(e => e.DisplayName).HasColumnName("DisplayName").HasMaxLength(255);
            entity.Property(e => e.TradeUnitCode).HasColumnName("TradeUnitCode").HasMaxLength(100);
            entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(500);
            entity.Property(e => e.AssignmentSource).HasColumnName("AssignmentSource").HasMaxLength(50);
            entity.Property(e => e.GroupId).HasColumnName("GroupId");
            entity.Property(e => e.GroupName).HasColumnName("GroupName").HasMaxLength(100);
        });
    }
}
