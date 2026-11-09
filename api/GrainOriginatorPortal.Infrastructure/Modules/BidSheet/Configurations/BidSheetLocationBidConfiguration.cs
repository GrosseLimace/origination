// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheetLocationBids</c>.</summary>
public sealed class BidSheetLocationBidConfiguration : IEntityTypeConfiguration<BidSheetLocationBid>
{
    public void Configure(EntityTypeBuilder<BidSheetLocationBid> entity)
    {
        entity.ToTable("BidSheetLocationBids", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.LocationId).IsRequired();
        entity.Property(e => e.CommodityCode).HasMaxLength(50).IsRequired();
        entity.Property(e => e.CommodityName).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.CommodityCategory).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.CropYear).IsRequired();
        entity.Property(e => e.Month).HasDefaultValue(0).IsRequired();
        entity.Property(e => e.Bid).HasMaxLength(50).IsRequired();
        // Feed provenance. Ownership moves with the value: a user typing over a fed cell flips it to
        // 'Manual', and the bridge takes it back on its next run. The bridge only ever writes
        // Source='Barchart'.
        entity.Property(e => e.Source).HasMaxLength(20).HasDefaultValue(BidSources.Manual).IsRequired();
        entity.Property(e => e.BarchartSymbol).HasMaxLength(100).IsRequired(false);
        entity.Property(e => e.BasisBid).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.BasisSymbol).HasMaxLength(100).IsRequired(false);
        // Widest value seen in the catalog is 6 characters (MWOU26); 20 leaves room for a longer root.
        entity.Property(e => e.UnderlyingFuture).HasMaxLength(20).IsRequired(false);
        entity.Property(e => e.QuoteAsOf).IsRequired(false);
        entity.Property(e => e.CoveredByCropYear).IsRequired(false);
        entity.Property(e => e.CoveredByMonth).IsRequired(false);
        entity.Property(e => e.CashChangedAt).IsRequired(false);
        entity.Property(e => e.BasisChangedAt).IsRequired(false);
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ModifiedAt).IsRequired(false);
        entity.HasIndex(e => new { e.LocationId, e.CommodityCode, e.CropYear, e.Month }).IsUnique().HasDatabaseName("UQ_BidSheetLocationBids_Location_Commodity_Year_Month");
    }
}
