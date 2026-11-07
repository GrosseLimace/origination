// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.FieldProgramRecord</c>.</summary>
public sealed class FieldProgramRecordConfiguration : IEntityTypeConfiguration<FieldProgramRecord>
{
    public void Configure(EntityTypeBuilder<FieldProgramRecord> entity)
    {
        entity.ToTable("FieldProgramRecord", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.ProducerFieldSeasonId).HasColumnName("ProducerFieldSeasonId").IsRequired();
        entity.Property(e => e.ProgramKey).HasColumnName("ProgramKey").HasMaxLength(30).IsRequired();
        entity.Property(e => e.Status).HasColumnName("Status").HasMaxLength(10).IsRequired();
        entity.Property(e => e.Data).HasColumnName("Data").IsRequired();
        entity.Property(e => e.CopiedFromYear).HasColumnName("CopiedFromYear").IsRequired(false);
        entity.Property(e => e.CopiedFromField).HasColumnName("CopiedFromField").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.Frozen).HasColumnName("Frozen").IsRequired(false);
        entity.Property(e => e.LockedBy).HasColumnName("LockedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.LockedAt).HasColumnName("LockedAt").IsRequired(false);
        entity.Property(e => e.Reopened).HasColumnName("Reopened").IsRequired(false);
        entity.Property(e => e.Official).HasColumnName("Official").IsRequired(false);
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.IsDeleted).HasColumnName("IsDeleted").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.DeletedAt).HasColumnName("DeletedAt").IsRequired(false);
        entity.Property(e => e.DeletedBy).HasColumnName("DeletedBy").HasMaxLength(255).IsRequired(false);

        entity.HasQueryFilter(e => !e.IsDeleted);

        entity.HasOne(e => e.Season)
              .WithMany()
              .HasForeignKey(e => e.ProducerFieldSeasonId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_FieldProgramRecord_ProducerFieldSeason_ProducerFieldSeasonId");

        // One record per program per season; removed rows don't count.
        entity.HasIndex(e => new { e.ProducerFieldSeasonId, e.ProgramKey })
              .IsUnique()
              .HasFilter("[IsDeleted] = 0")
              .HasDatabaseName("UQ_FieldProgramRecord_Season_Program");
    }
}
