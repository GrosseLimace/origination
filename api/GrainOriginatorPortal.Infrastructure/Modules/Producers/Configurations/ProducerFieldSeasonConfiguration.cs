// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerFieldSeason</c>.</summary>
public sealed class ProducerFieldSeasonConfiguration : IEntityTypeConfiguration<ProducerFieldSeason>
{
    public void Configure(EntityTypeBuilder<ProducerFieldSeason> entity)
    {
        entity.ToTable("ProducerFieldSeason", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.ProducerFieldId).HasColumnName("ProducerFieldId").IsRequired();
        entity.Property(e => e.PlantingIntentionId).HasColumnName("PlantingIntentionId").IsRequired();
        entity.Property(e => e.CropYear).HasColumnName("CropYear").IsRequired();
        entity.Property(e => e.CropLabel).HasColumnName("CropLabel").HasMaxLength(100).IsRequired();
        entity.Property(e => e.Acres).HasColumnName("Acres").HasColumnType("decimal(10,2)").IsRequired(false);
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.IsDeleted).HasColumnName("IsDeleted").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.DeletedAt).HasColumnName("DeletedAt").IsRequired(false);
        entity.Property(e => e.DeletedBy).HasColumnName("DeletedBy").HasMaxLength(255).IsRequired(false);

        // Soft delete once, on the model, as for planting intentions (see the comment there).
        entity.HasQueryFilter(e => !e.IsDeleted);

        // A field is on a crop row once. The service also refuses a second row of the same crop (FIELD_PLAN_FIELD_ON_ROW);
        // this backs the same-row half of that rule in the database. Soft-deleted rows don't count.
        entity.HasIndex(e => new { e.ProducerFieldId, e.PlantingIntentionId })
              .IsUnique()
              .HasFilter("[IsDeleted] = 0")
              .HasDatabaseName("UQ_ProducerFieldSeason_Field_PlantingIntention");

        entity.HasOne(e => e.Field)
              .WithMany()
              .HasForeignKey(e => e.ProducerFieldId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerFieldSeason_ProducerField_ProducerFieldId");
        // No navigation: the crop row is read through the planting-intentions API, and its soft-delete
        // filter shouldn't hide a field's history.
        entity.HasOne<PlantingIntention>()
              .WithMany()
              .HasForeignKey(e => e.PlantingIntentionId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerFieldSeason_ProducerPlantingIntentions_PlantingIntentionId");

        entity.HasIndex(e => e.ProducerFieldId).HasDatabaseName("IX_ProducerFieldSeason_ProducerFieldId");
        entity.HasIndex(e => e.PlantingIntentionId).HasDatabaseName("IX_ProducerFieldSeason_PlantingIntentionId");
    }
}
