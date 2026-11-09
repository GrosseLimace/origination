// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.CustomerCommodity</c>.</summary>
public sealed class CustomerCommodityConfiguration : IEntityTypeConfiguration<CustomerCommodity>
{
    public void Configure(EntityTypeBuilder<CustomerCommodity> entity)
    {
        entity.ToTable("CustomerCommodity", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.CommodityId).HasColumnName("CommodityId").IsRequired();

        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_CustomerCommodity_Customer");
        entity.HasOne(e => e.Commodity)
              .WithMany()
              .HasForeignKey(e => e.CommodityId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_CustomerCommodity_Commodity");

        // One row per (customer, commodity) — duplicates make no sense.
        entity.HasIndex(e => new { e.CustomerId, e.CommodityId })
              .IsUnique()
              .HasDatabaseName("UQ_CustomerCommodity_Customer_Commodity");
        // Reverse-lookup index — "which customers grow commodity X?"
        entity.HasIndex(e => e.CommodityId).HasDatabaseName("IX_CustomerCommodity_CommodityId");
    }
}
