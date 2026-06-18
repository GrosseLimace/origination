using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Read-only DbContext for the Entitlements database.
/// Only maps views — no migrations or writes are performed against this context.
/// </summary>
public class EntitlementsDbContext : DbContext
{
    public EntitlementsDbContext(DbContextOptions<EntitlementsDbContext> options)
        : base(options)
    {
    }

    public DbSet<UserTradeUnitAccess> UserTradeUnitAccess => Set<UserTradeUnitAccess>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<UserTradeUnitAccess>(entity =>
        {
            entity.ToView("vw_UserTradeUnitAccess", schema: "dbo");
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
