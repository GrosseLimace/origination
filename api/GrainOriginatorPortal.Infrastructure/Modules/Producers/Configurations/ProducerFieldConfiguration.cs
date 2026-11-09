// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary>
/// <c>dbo.ProducerField</c>. Fields are CTRM splits; program inputs and frozen estimates are JSON because they
/// differ by program and by USDA version. See docs/application-context/Field Plan - Database Plan.md.
/// </summary>
public sealed class ProducerFieldConfiguration : IEntityTypeConfiguration<ProducerField>
{
    public void Configure(EntityTypeBuilder<ProducerField> entity)
    {
        entity.ToTable("ProducerField", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.SplitId).HasColumnName("SplitId").HasMaxLength(20).IsRequired();
        entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(255).IsRequired();
        entity.Property(e => e.SplitPercent).HasColumnName("SplitPercent").HasColumnType("decimal(7,3)").IsRequired();
        entity.Property(e => e.EffectiveDate).HasColumnName("EffectiveDate").HasColumnType("date").IsRequired(false);
        entity.Property(e => e.State).HasColumnName("State").HasMaxLength(2).IsRequired(false);
        entity.Property(e => e.County).HasColumnName("County").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.SplitSource).HasColumnName("SplitSource").HasMaxLength(10).HasDefaultValue("Manual").IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);

        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerField_Customer_CustomerId");

        // A split is one producer's field, so it can be claimed once across all producers.
        entity.HasIndex(e => e.SplitId).IsUnique().HasDatabaseName("UQ_ProducerField_SplitId");
        entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_ProducerField_CustomerId");
    }
}
