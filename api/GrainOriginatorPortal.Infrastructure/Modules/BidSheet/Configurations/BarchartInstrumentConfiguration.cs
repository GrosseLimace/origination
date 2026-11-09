// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BarchartInstrument</c>.</summary>
public sealed class BarchartInstrumentConfiguration : IEntityTypeConfiguration<BarchartInstrument>
{
    public void Configure(EntityTypeBuilder<BarchartInstrument> entity)
    {
        entity.ToTable("BarchartInstrument", schema: "dbo");
        entity.HasKey(e => e.Symbol);
        entity.Property(e => e.Symbol).HasMaxLength(100).IsRequired();
        entity.Property(e => e.LocationKey).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.Root).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.InstrumentType).HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.DeliveryWindowFlag).HasColumnType("char(1)").IsRequired(false);
        entity.Property(e => e.SymbolDescription).HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.Elevator).HasMaxLength(300).IsRequired(false);
        entity.Property(e => e.LocationName).HasMaxLength(300).IsRequired(false);
        entity.Property(e => e.FacilityType).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.Commodity).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.UnderlyingFuture).HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.DeliveryStart).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.DeliveryEnd).HasColumnType("datetime2(3)").IsRequired(false);
        entity.Property(e => e.Address).HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.City).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.State).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.ZipCode).HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.Latitude).IsRequired(false);
        entity.Property(e => e.Longitude).IsRequired(false);
        entity.Property(e => e.County).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.StateFips).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.CountyFips).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.Phone).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.Website).HasMaxLength(300).IsRequired(false);
        entity.Property(e => e.IsTest).HasDefaultValue(false).IsRequired();
        entity.Property(e => e.IsActive).HasDefaultValue(true).IsRequired();
        entity.Property(e => e.FirstSeenUtc).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.Property(e => e.LastSeenUtc).HasColumnType("datetime2(3)").HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        // Drives the picker's group-by-location reads and the bridge's instrument lookup.
        entity.HasIndex(e => e.LocationKey)
              .HasDatabaseName("IX_BarchartInstrument_LocationKey")
              .IncludeProperties(e => new { e.Commodity, e.InstrumentType, e.IsActive, e.IsTest });
        entity.HasIndex(e => new { e.State, e.City }).HasDatabaseName("IX_BarchartInstrument_State_City");
    }
}
