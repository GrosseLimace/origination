// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.UsageAnalytics.Configurations;

/// <summary><c>dbo.UsageDashboardExcludedUsers</c>.</summary>
public sealed class UsageDashboardExcludedUserConfiguration : IEntityTypeConfiguration<UsageDashboardExcludedUser>
{
    public void Configure(EntityTypeBuilder<UsageDashboardExcludedUser> entity)
    {
        entity.ToTable("UsageDashboardExcludedUsers", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
        entity.Property(e => e.Reason).HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired().HasDefaultValue("system");
        // Unique so the same account can't be excluded twice; SQL Server's default CI collation
        // makes it case-insensitive, matching how the dashboard keys users.
        entity.HasIndex(e => e.UserId).IsUnique().HasDatabaseName("IX_UsageDashboardExcludedUsers_UserId");
    }
}
