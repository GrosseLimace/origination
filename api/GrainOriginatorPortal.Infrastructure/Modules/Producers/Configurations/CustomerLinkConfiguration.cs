// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers.Configurations;

/// <summary><c>dbo.CustomerLink</c>.</summary>
public sealed class CustomerLinkConfiguration : IEntityTypeConfiguration<CustomerLink>
{
    public void Configure(EntityTypeBuilder<CustomerLink> entity)
    {
        entity.ToTable("CustomerLink", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.FromCustomerId).HasColumnName("FromCustomerId").IsRequired();
        entity.Property(e => e.ToCustomerId).HasColumnName("ToCustomerId").IsRequired();

        entity.HasOne(e => e.FromCustomer)
              .WithMany()
              .HasForeignKey(e => e.FromCustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_CustomerLink_Customer_From");
        entity.HasOne(e => e.ToCustomer)
              .WithMany()
              .HasForeignKey(e => e.ToCustomerId)
              .OnDelete(DeleteBehavior.NoAction)
              .HasConstraintName("FK_CustomerLink_Customer_To");

        // One row per directed pair.
        entity.HasIndex(e => new { e.FromCustomerId, e.ToCustomerId })
              .IsUnique()
              .HasDatabaseName("UQ_CustomerLink_From_To");
        // Reverse-lookup index — "who links TO this customer?"
        entity.HasIndex(e => e.ToCustomerId).HasDatabaseName("IX_CustomerLink_ToCustomerId");
    }
}
