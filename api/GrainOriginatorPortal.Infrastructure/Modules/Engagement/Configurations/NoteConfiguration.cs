// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.Notes</c>.</summary>
public sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> entity)
    {
        entity.ToTable("Notes", schema: "dbo");
        entity.HasKey(e => e.Id);

        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        // CustomerName / CustomerCode dropped from the DB (Phase 3b) — they live
        // on the DTO for API contract stability, populated from the Customer FK
        // join on reads. .Ignore() keeps EF from trying to read/write the columns.
        entity.Ignore(e => e.CustomerName);
        entity.Ignore(e => e.CustomerCode);
        entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.Description).HasColumnName("Description").HasColumnType("nvarchar(max)").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(200).IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.IsPinned).HasColumnName("IsPinned").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.Subject).HasColumnName("Subject").HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.MentionsJson).HasColumnName("Mentions").HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.IsDeleted).HasColumnName("IsDeleted").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.DeletedAt).HasColumnName("DeletedAt").IsRequired(false);
        entity.Property(e => e.DeletedBy).HasColumnName("DeletedBy").HasMaxLength(200).IsRequired(false);

        entity.Ignore(e => e.Content);

        // FK to dbo.Customer — NoAction so cascading deletes from Customer don't
        // wipe user-authored notes. The populate endpoint disables this constraint
        // temporarily while it rebuilds the Customer table.
        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_Notes_Customer_CustomerId");

        entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_Notes_CustomerId");

        // Covering index for the last-contact aggregate (GROUP BY CustomerId +
        // MAX(CreatedAt) with a TradeUnit residual predicate) and for per-customer
        // reads ordered by CreatedAt. Filtered to live rows; touches no LOB columns,
        // so the aggregate never reads Description/Mentions pages.
        entity.HasIndex(e => new { e.CustomerId, e.CreatedAt })
              .HasDatabaseName("IX_Notes_CustomerId_CreatedAt")
              .HasFilter("[IsDeleted] = 0")
              .IncludeProperties(e => e.TradeUnit);

        // Supports dbo.GetRecapNotes (WHERE CreatedBy = @user AND CreatedAt >= ...),
        // which otherwise full-scans the table once per recap recipient. Deliberately
        // NOT filtered on IsDeleted because the proc doesn't filter it (pre-existing
        // behavior — deleted notes appear in recaps; flagged separately, not changed here).
        entity.HasIndex(e => new { e.CreatedBy, e.CreatedAt })
              .HasDatabaseName("IX_Notes_CreatedBy_CreatedAt");
    }
}
