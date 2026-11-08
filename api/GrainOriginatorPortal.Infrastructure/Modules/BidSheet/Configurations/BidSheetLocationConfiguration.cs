// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheetLocations</c>.</summary>
public sealed class BidSheetLocationConfiguration : IEntityTypeConfiguration<BidSheetLocation>
{
    public void Configure(EntityTypeBuilder<BidSheetLocation> entity)
    {
        entity.ToTable("BidSheetLocations", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
        entity.Property(e => e.Address).HasMaxLength(300).IsRequired(false);
        entity.Property(e => e.City).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.State).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.Latitude).IsRequired(false);
        entity.Property(e => e.Longitude).IsRequired(false);
        entity.Property(e => e.ElevatorCode).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.BarchartLocationKey).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.TradeUnitCode).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.GroupName).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.IsScoularFacility).HasDefaultValue(false).IsRequired();
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ModifiedAt).IsRequired(false);
        // ONE row per BarChart listing, company-wide. This replaced a per-trade-unit uniqueness rule:
        // the same elevator used to be stored once per desk, so the map showed it several times over
        // and the bridge wrote the identical fed price into every copy. Enforced by the database and
        // not only by a read-then-write check, because the bulk add fires its creates in PARALLEL --
        // two for the same listing could both pass that check and both insert. Filtered so the many
        // rows with no BarChart link are exempt.
        entity.HasIndex(e => e.BarchartLocationKey)
              .HasDatabaseName("UQ_BidSheetLocations_BarchartKey")
              .IsUnique()
              .HasFilter("[BarchartLocationKey] IS NOT NULL");
        entity.HasMany(e => e.Bids).WithOne(b => b.Location).HasForeignKey(b => b.LocationId).OnDelete(DeleteBehavior.Cascade);
    }
}
