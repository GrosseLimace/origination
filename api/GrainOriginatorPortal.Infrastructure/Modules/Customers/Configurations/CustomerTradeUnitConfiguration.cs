// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Customers.Configurations;

/// <summary><c>dbo.CustomerTradeUnit</c>: one row per (customer, trade unit) membership.</summary>
public sealed class CustomerTradeUnitConfiguration : IEntityTypeConfiguration<CustomerTradeUnit>
{
    public void Configure(EntityTypeBuilder<CustomerTradeUnit> entity)
    {
        entity.ToTable("CustomerTradeUnit", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CustomerId).HasColumnName("CustomerId").IsRequired();
        entity.Property(e => e.TradeUnit).HasColumnName("TradeUnit").HasMaxLength(100).IsRequired();
        entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
        entity.Property(e => e.IsManual).HasColumnName("IsManual").HasDefaultValue(false).IsRequired();
        // Additive flag (default false) — see CustomerTradeUnit.UserDeactivated. No-op for
        // existing rows; only set when a user removes a dormant sync-sourced membership.
        entity.Property(e => e.UserDeactivated).HasColumnName("UserDeactivated").HasDefaultValue(false).IsRequired();

        // Audit columns — same convention as Notes/ProducerDetails/Dashboard*. CreatedAt
        // defaults to GETUTCDATE() at the DB; CreatedBy is required; Modified* are nullable.
        // The nightly sync writes "system"; manual user actions write the acting user's UPN.
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);

        // FK to Customer.Id (the ODS CustomerId surrogate). NoAction like every other FK into Customer:
        // these rows are hand-curated trade-unit assignments, and a customer delete must be blocked
        // by them, not silently take them along. Was Cascade until 2026-10-13; production held 22,491
        // rows behind it at the time (nothing deletes customers today, so none were ever lost).
        entity.HasOne(e => e.Customer)
              .WithMany()
              .HasForeignKey(e => e.CustomerId)
              .OnDelete(DeleteBehavior.NoAction);

        // One row per (customer, trade-unit) pair.
        entity.HasIndex(e => new { e.CustomerId, e.TradeUnit })
              .IsUnique()
              .HasDatabaseName("UQ_CustomerTradeUnit_CustomerId_TradeUnit");

        // Covering scope index — main TU-filtered query: WHERE TradeUnit IN (...) AND IsActive = 1.
        entity.HasIndex(e => new { e.TradeUnit, e.IsActive })
              .HasDatabaseName("IX_CustomerTradeUnit_TradeUnit_IsActive");
    }
}
