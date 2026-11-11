// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Customers.Configurations;

/// <summary><c>dbo.Customer</c>: one row per customer, keyed by its customer id, with the attribute columns.</summary>
public sealed class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> entity)
    {
        entity.ToTable("Customer", schema: "dbo");
        entity.HasKey(e => e.Id);

        // Id is the ODS CustomerId — not auto-generated; provided by sync.
        entity.Property(e => e.Id).HasColumnName("CustomerId").ValueGeneratedNever().IsRequired();
        entity.Property(e => e.Name).HasColumnName("CustomerName").HasMaxLength(500).IsRequired();
        // Trim on read — ODS source columns are CHAR-padded; without trimming, comparisons
        // against Note.CustomerCode / Contract.SourceContractId (which both use Trim conversion)
        // silently fail. Matches the pattern used in OriginationDbContext for similar columns.
        entity.Property(e => e.ScoularId).HasColumnName("ScoularId").HasMaxLength(400).IsRequired(false)
              .HasConversion(v => v, v => v != null ? v.Trim() : v);
        entity.Property(e => e.IndustryCode1).HasColumnName("IndustryCode1").HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.IndustryCode2).HasColumnName("IndustryCode2").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.NopIdNumber).HasColumnName("NopIdNumber").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
        entity.Property(e => e.IsManual).HasColumnName("IsManual").HasDefaultValue(false).IsRequired();
        entity.Property(e => e.EffectiveStartDate).HasColumnName("EffectiveStartDate").IsRequired(false);
        entity.Property(e => e.EffectiveEndDate).HasColumnName("EffectiveEndDate").IsRequired(false);

        // Contact columns — column names mirror the ODS source view for consistency.
        entity.Property(e => e.Phone).HasColumnName("MerchandisingPhone").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.Email).HasColumnName("MerchandisingEmail").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedPrimaryPhone).HasColumnName("ExtendedPrimaryPhone").HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.SupplementalEmail).HasColumnName("SupplementalEmail").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.Location).HasColumnName("MerchandisingCity").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.StateProvince).HasColumnName("MerchandisingStateProvince").HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.AddressLine1).HasColumnName("MerchandisingAddressLine1").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.PostalCode).HasColumnName("MerchandisingPostalCode").HasMaxLength(20).IsRequired(false);

        // Extended address fields — more accurate location data for geocoding.
        entity.Property(e => e.ExtendedAddressLine1).HasColumnName("ExtendedAddressLine1").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedAddressLine2).HasColumnName("ExtendedAddressLine2").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedAddressLine3).HasColumnName("ExtendedAddressLine3").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedAddressLine4).HasColumnName("ExtendedAddressLine4").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedCity).HasColumnName("ExtendedCity").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ExtendedPostalCode).HasColumnName("ExtendedPostalCode").HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.ExtendedStateProvince).HasColumnName("ExtendedStateProvince").HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.ExtendedCountry).HasColumnName("ExtendedCountry").HasMaxLength(255).IsRequired(false);

        // CTRM payment method code ('H' = ACH) — filled by the ctrm customer sync (plan E2); null on ods.
        entity.Property(e => e.PaymentMethod).HasColumnName("PaymentMethod").HasMaxLength(Customer.PaymentMethodMaxLength).IsRequired(false);

        // DTO-only fields — populated by service layer enrichment, not stored on the table.
        entity.Ignore(e => e.CustomerCode);
        entity.Ignore(e => e.ESignEnabled);
        entity.Ignore(e => e.AchEnabled);
        entity.Ignore(e => e.ActiveTradeUnits);
        entity.Ignore(e => e.ScoularViewRecipients);
        entity.Ignore(e => e.Guild);
        entity.Ignore(e => e.Coordinates);

        entity.HasIndex(e => e.Name).HasDatabaseName("IX_Customer_CustomerName");
        entity.HasIndex(e => e.ScoularId).HasDatabaseName("IX_Customer_ScoularId");
    }
}
