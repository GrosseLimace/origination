// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.ProducerReminders</c>.</summary>
public sealed class ProducerReminderConfiguration : IEntityTypeConfiguration<ProducerReminder>
{
    public void Configure(EntityTypeBuilder<ProducerReminder> entity)
    {
        entity.ToTable("ProducerReminders", schema: "dbo");
        entity.HasKey(e => e.Id);

        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.DueAt).HasColumnName("DueAt").IsRequired();
        entity.Property(e => e.Subject).HasColumnName("Subject").HasMaxLength(200).IsRequired();
        entity.Property(e => e.Notes).HasColumnName("Notes").HasMaxLength(2000).IsRequired(false);
        entity.Property(e => e.OutlookEventId).HasColumnName("OutlookEventId").HasMaxLength(256).IsRequired(false);
        entity.Property(e => e.IsCompleted).HasColumnName("IsCompleted").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.CompletedAt).HasColumnName("CompletedAt").IsRequired(false);
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(200).IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);

        // Composed from the Customer FK join on read, never stored — same decision as Notes.
        entity.Ignore(e => e.CustomerName);
        entity.Ignore(e => e.CustomerCode);

        // NoAction so a Customer rebuild can't wipe user-authored reminders (matches Notes).
        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerReminders_Customer_CustomerId");

        // The producer-pane read: one owner's reminders for one producer, newest due first.
        entity.HasIndex(e => new { e.CustomerId, e.CreatedBy, e.IsCompleted })
              .HasDatabaseName("IX_ProducerReminders_CustomerId_CreatedBy_IsCompleted");

        // The badge feed: every OPEN reminder for one owner across all producers. Filtered so
        // completed rows never enter the index — the feed only ever asks for open ones.
        entity.HasIndex(e => new { e.CreatedBy, e.DueAt })
              .HasDatabaseName("IX_ProducerReminders_CreatedBy_DueAt")
              .HasFilter("[IsCompleted] = 0");
    }
}
