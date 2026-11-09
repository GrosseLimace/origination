// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerPlantingIntentions</c>.</summary>
public sealed class PlantingIntentionConfiguration : IEntityTypeConfiguration<PlantingIntention>
{
    public void Configure(EntityTypeBuilder<PlantingIntention> entity)
    {
        entity.ToTable("ProducerPlantingIntentions", schema: "dbo");
        entity.HasKey(e => e.Id);

        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        // CustomerName / CustomerCode dropped from the DB (Phase 3b) — populated
        // from the Customer FK join on reads.
        entity.Ignore(e => e.CustomerName);
        entity.Ignore(e => e.CustomerCode);
        entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired();
        entity.Property(e => e.PlantingYear).HasColumnName("PlantingYear").IsRequired();
        entity.Property(e => e.Crop).HasColumnName("Crop").HasMaxLength(100).IsRequired();
        entity.Property(e => e.Category).HasColumnName("Category").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.Type).HasColumnName("Type").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.Acres).HasColumnName("Acres").IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.IsDeleted).HasColumnName("IsDeleted").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.DeletedAt).HasColumnName("DeletedAt").IsRequired(false);
        entity.Property(e => e.DeletedBy).HasColumnName("DeletedBy").HasMaxLength(255).IsRequired(false);

        // Soft delete is enforced HERE, once, rather than by an IsDeleted predicate on each
        // query. Note takes the per-query approach and repeats "!IsDeleted" in eleven places:
        // that works until someone adds a twelfth query and forgets, and then deleted rows
        // reappear in a view. It matters more here than for notes because these rows are SUMMED
        // — the trade-unit acreage rollups would silently over-count a deleted plan, giving a
        // wrong number with no error. A filter on the model cannot be forgotten by new code.
        //
        // To read deleted rows deliberately (recovery, audit), use IgnoreQueryFilters().
        entity.HasQueryFilter(e => !e.IsDeleted);

        // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
        // wipe user-authored planting intentions.
        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerPlantingIntentions_Customer_CustomerId");

        entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_ProducerPlantingIntentions_CustomerId");
        entity.HasIndex(e => new { e.TradeUnit, e.PlantingYear }).HasDatabaseName("IX_ProducerPlantingIntentions_TradeUnit");
    }
}
