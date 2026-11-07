// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerDetails</c>.</summary>
public sealed class ProducerDetailsConfiguration : IEntityTypeConfiguration<ProducerDetails>
{
    public void Configure(EntityTypeBuilder<ProducerDetails> entity)
    {
        entity.ToTable("ProducerDetails", schema: "dbo");
        entity.HasKey(e => e.Id);

        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        // ScoularId / CustomerName / LinkedProducerIds dropped from the DB
        // (Phase 3b). ScoularId + CustomerName come from the Customer FK join.
        // LinkedProducerIds is composed server-side from dbo.CustomerLink on read.
        entity.Ignore(e => e.ScoularId);
        entity.Ignore(e => e.CustomerName);
        entity.Ignore(e => e.LinkedProducerIds);
        entity.Property(e => e.TotalAcres).HasColumnName("TotalAcres").HasColumnType("decimal(18,2)").IsRequired(false);
        entity.Property(e => e.BinSitesModifiedAt).HasColumnName("BinSitesModifiedAt").IsRequired(false);
        entity.Property(e => e.PrimaryContact).HasColumnName("PrimaryContact").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.PrimaryPhone).HasColumnName("PrimaryPhone").HasMaxLength(50).IsRequired(false);
        // Commodities is composed server-side from dbo.CustomerCommodity on read
        // (Phase 4b). The column was dropped from dbo.ProducerDetails; the property
        // stays on the DTO for API contract stability.
        entity.Ignore(e => e.Commodities);
        // GrainOnFarm is composed server-side from dbo.ProducerGrainOnFarm on read / rebuilt on upsert.
        entity.Ignore(e => e.GrainOnFarm);
        // Contacts is composed server-side from dbo.ProducerContact on read / rebuilt on upsert.
        entity.Ignore(e => e.Contacts);
        // BinSites is composed server-side from dbo.ProducerBinSite on read / rebuilt on upsert.
        entity.Ignore(e => e.BinSites);
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);

        // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
        // wipe rep-authored producer details. UNIQUE index on CustomerId enforces
        // the 1:1 relationship.
        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerDetails_Customer_CustomerId");

        entity.HasIndex(e => e.CustomerId).IsUnique().HasDatabaseName("IX_ProducerDetails_CustomerId");
    }
}
