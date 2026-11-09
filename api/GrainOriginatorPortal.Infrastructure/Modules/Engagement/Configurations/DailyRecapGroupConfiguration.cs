// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.DailyRecapGroups</c>.</summary>
public sealed class DailyRecapGroupConfiguration : IEntityTypeConfiguration<DailyRecapGroup>
{
    public void Configure(EntityTypeBuilder<DailyRecapGroup> entity)
    {
        entity.ToTable("DailyRecapGroups", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
        entity.Property(e => e.DeliveryMethod).HasMaxLength(20).IsRequired();
        entity.Property(e => e.TeamsChannelEmail).HasMaxLength(256).IsRequired(false);
        entity.Property(e => e.Enabled).HasDefaultValue(true).IsRequired();

        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ModifiedAt).IsRequired(false);
        entity.HasIndex(e => e.CreatedBy).HasDatabaseName("IX_DailyRecapGroups_CreatedBy");
        entity.HasMany(e => e.Members).WithOne(m => m.Group).HasForeignKey(m => m.RecapGroupId).OnDelete(DeleteBehavior.Cascade);
        entity.HasMany(e => e.CcEmails).WithOne(c => c.Group).HasForeignKey(c => c.RecapGroupId).OnDelete(DeleteBehavior.Cascade);
    }
}
