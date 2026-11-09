// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BarchartCommodityMap</c>.</summary>
public sealed class BarchartCommodityMapConfiguration : IEntityTypeConfiguration<BarchartCommodityMap>
{
    public void Configure(EntityTypeBuilder<BarchartCommodityMap> entity)
    {
        entity.ToTable("BarchartCommodityMap", schema: "dbo");
        entity.HasKey(e => e.BarchartCommodity);
        entity.Property(e => e.BarchartCommodity).HasMaxLength(200).IsRequired();
        entity.Property(e => e.CommodityCode).HasMaxLength(50).IsRequired();
        entity.Property(e => e.CommodityName).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.CommodityCategory).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.IsActive).HasDefaultValue(true).IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
    }
}
