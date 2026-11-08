// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.FieldPlanDocument</c>.</summary>
public sealed class FieldPlanDocumentConfiguration : IEntityTypeConfiguration<FieldPlanDocument>
{
    public void Configure(EntityTypeBuilder<FieldPlanDocument> entity)
    {
        entity.ToTable("FieldPlanDocument", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.DocStoreId).HasColumnName("DocStoreId").HasMaxLength(36).IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.CropYear).HasColumnName("CropYear").IsRequired();
        entity.Property(e => e.DocumentType).HasColumnName("DocumentType").HasMaxLength(30).IsRequired();
        entity.Property(e => e.FieldProgramRecordId).HasColumnName("FieldProgramRecordId").IsRequired(false);
        entity.Property(e => e.SplitId).HasColumnName("SplitId").HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.Commodity).HasColumnName("Commodity").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.FileName).HasColumnName("FileName").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ContentType).HasColumnName("ContentType").HasMaxLength(100).IsRequired();
        entity.Property(e => e.SizeBytes).HasColumnName("SizeBytes").IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedByName).HasColumnName("CreatedByName").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.FieldName).HasColumnName("FieldName").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.Status).HasColumnName("Status").HasMaxLength(20).HasDefaultValue(FieldPlanDocument.Current).IsRequired();
        entity.Property(e => e.StatusChangedAt).HasColumnName("StatusChangedAt").IsRequired(false);
        entity.Property(e => e.StatusChangedBy).HasColumnName("StatusChangedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.StatusChangedByName).HasColumnName("StatusChangedByName").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.StatusNote).HasColumnName("StatusNote").HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.ReplacedByDocStoreId).HasColumnName("ReplacedByDocStoreId").HasMaxLength(36).IsRequired(false);

        entity.HasOne<Customer>()
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_FieldPlanDocument_Customer_CustomerId");

        entity.HasOne<FieldProgramRecord>()
              .WithMany()
              .HasForeignKey(e => e.FieldProgramRecordId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_FieldPlanDocument_FieldProgramRecord_FieldProgramRecordId");

        entity.HasIndex(e => e.DocStoreId).IsUnique().HasDatabaseName("UQ_FieldPlanDocument_DocStoreId");
        // The dialog lists a producer's documents for a crop year.
        entity.HasIndex(e => new { e.CustomerId, e.CropYear }).HasDatabaseName("IX_FieldPlanDocument_Customer_CropYear");
    }
}
