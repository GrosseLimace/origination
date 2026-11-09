// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerBinSite</c>.</summary>
public sealed class ProducerBinSiteConfiguration : IEntityTypeConfiguration<ProducerBinSite>
{
    public void Configure(EntityTypeBuilder<ProducerBinSite> entity)
    {
        entity.ToTable("ProducerBinSite", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        // NEWID() default only backfills rows that existed before the column; the app always sets it.
        entity.Property(e => e.SiteKey).HasColumnName("SiteKey").HasDefaultValueSql("NEWID()").IsRequired();
        entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(BinSiteRules.NameMaxLength).IsRequired(false);
        // decimal(18,15): three integer digits (±180) and fifteen places, so a full Google Maps
        // paste is stored exactly as entered. Display shortens it; storage never does.
        entity.Property(e => e.Latitude).HasColumnName("Latitude").HasColumnType("decimal(18,15)").IsRequired(false);
        entity.Property(e => e.Longitude).HasColumnName("Longitude").HasColumnType("decimal(18,15)").IsRequired(false);
        // Bushels, decimal(18,2) — the type the dropped ProducerDetails.BinCapacity had, so the values
        // moved onto "Bin 1" sites landed exactly.
        entity.Property(e => e.Capacity).HasColumnName("Capacity").HasColumnType("decimal(18,2)").IsRequired(false);
        entity.Property(e => e.SortOrder).HasColumnName("SortOrder").HasDefaultValue(0).IsRequired();

        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerBinSite_Customer");

        entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_ProducerBinSite_CustomerId");
        entity.HasIndex(e => e.SiteKey).IsUnique().HasDatabaseName("UQ_ProducerBinSite_SiteKey");
    }
}
