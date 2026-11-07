// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.ProducerContact</c>.</summary>
public sealed class ProducerContactConfiguration : IEntityTypeConfiguration<ProducerContact>
{
    public void Configure(EntityTypeBuilder<ProducerContact> entity)
    {
        entity.ToTable("ProducerContact", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(200).IsRequired();
        entity.Property(e => e.Phone).HasColumnName("Phone").HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.Email).HasColumnName("Email").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.IsPrimary).HasColumnName("IsPrimary").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.SortOrder).HasColumnName("SortOrder").HasDefaultValue(0).IsRequired();

        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_ProducerContact_Customer");

        // Plain (non-unique) index — a producer can have many contacts, and names/labels can
        // legitimately repeat (Dad's cell + Dad's shop), unlike the grain table's UQ.
        entity.HasIndex(e => e.CustomerId).HasDatabaseName("IX_ProducerContact_CustomerId");
    }
}
