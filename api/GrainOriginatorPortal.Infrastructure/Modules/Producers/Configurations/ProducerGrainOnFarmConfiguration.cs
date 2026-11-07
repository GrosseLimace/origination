// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerGrainOnFarm</c>.</summary>
public sealed class ProducerGrainOnFarmConfiguration : IEntityTypeConfiguration<ProducerGrainOnFarm>
{
    public void Configure(EntityTypeBuilder<ProducerGrainOnFarm> entity)
    {
        entity.ToTable("ProducerGrainOnFarm", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.BinSiteId).HasColumnName("BinSiteId").IsRequired(false);
        entity.Property(e => e.CommodityCode).HasColumnName("CommodityCode").HasMaxLength(100).IsRequired();
        entity.Property(e => e.BushelsOnHand).HasColumnName("BushelsOnHand").HasColumnType("decimal(18,2)").IsRequired(false);
        entity.Property(e => e.BushelsSold).HasColumnName("BushelsSold").HasColumnType("decimal(18,2)").IsRequired(false);
        entity.Property(e => e.TargetBushels).HasColumnName("TargetBushels").HasColumnType("decimal(18,2)").IsRequired(false);
        entity.Property(e => e.LastBid).HasColumnName("LastBid").HasColumnType("decimal(18,4)").IsRequired(false);
        entity.Property(e => e.Grade).HasColumnName("Grade").HasMaxLength(100).IsRequired(false);

        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerGrainOnFarm_Customer");

        // NoAction like every producer child table: the repository removes a site's grain rows
        // before the site, in the same SaveChanges.
        entity.HasOne(e => e.BinSite)
              .WithMany()
              .HasForeignKey(e => e.BinSiteId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerGrainOnFarm_BinSite");
        entity.HasIndex(e => e.BinSiteId).HasDatabaseName("IX_ProducerGrainOnFarm_BinSiteId");

        // One row per (customer, bin site, commodity code). HasFilter(null) drops EF's default
        // "BinSiteId IS NOT NULL" filter so rows without a site stay one per commodity too
        // (SQL Server treats NULLs as equal in a unique index). 100 chars, not a code-sized
        // width, because rows saved before 2026-09-23 still hold a crop-group name.
        entity.HasIndex(e => new { e.CustomerId, e.BinSiteId, e.CommodityCode })
              .IsUnique()
              .HasFilter(null)
              .HasDatabaseName("UQ_ProducerGrainOnFarm_Customer_Site_Commodity");
    }
}
