// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.DashboardActualHarvests</c>.</summary>
public sealed class DashboardActualHarvestConfiguration : IEntityTypeConfiguration<DashboardActualHarvest>
{
    public void Configure(EntityTypeBuilder<DashboardActualHarvest> entity)
    {
        entity.ToTable("DashboardActualHarvests", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.TradeUnitKey).HasColumnName("TradeUnitKey").HasMaxLength(500).IsRequired();
        entity.Property(e => e.CropCategory).HasColumnName("CropCategory").HasMaxLength(100).IsRequired();
        entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
        entity.Property(e => e.Bushels).HasColumnName("Bushels").IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.HasIndex(e => new { e.TradeUnitKey, e.PlantingYear }).HasDatabaseName("IX_DashboardActualHarvests_TradeUnitKey_PlantingYear");
    }
}
