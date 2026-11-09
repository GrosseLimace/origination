// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.DashboardPlantingEstimates</c>.</summary>
public sealed class DashboardPlantingEstimateConfiguration : IEntityTypeConfiguration<DashboardPlantingEstimate>
{
    public void Configure(EntityTypeBuilder<DashboardPlantingEstimate> entity)
    {
        entity.ToTable("DashboardPlantingEstimates", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.TradeUnitKey).HasColumnName("TradeUnitKey").HasMaxLength(500).IsRequired();
        entity.Property(e => e.Crop).HasColumnName("Crop").HasMaxLength(100).IsRequired();
        entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
        entity.Property(e => e.YieldEstimate).HasColumnName("YieldEstimate").HasColumnType("decimal(10,2)").IsRequired(false);
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.HasIndex(e => new { e.TradeUnitKey, e.Crop, e.PlantingYear }).IsUnique()
            .HasDatabaseName("UQ_DashboardPlantingEstimates_TradeUnitKey_Crop_PlantingYear");
    }
}
