// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheetPreferences</c>.</summary>
public sealed class BidSheetPreferenceConfiguration : IEntityTypeConfiguration<BidSheetPreference>
{
    public void Configure(EntityTypeBuilder<BidSheetPreference> entity)
    {
        entity.ToTable("BidSheetPreferences", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.UserId).HasMaxLength(256).IsRequired();
        entity.Property(e => e.TradeUnitKey).HasMaxLength(500).IsRequired();
        entity.Property(e => e.CropCode).HasMaxLength(50).IsRequired(false);
        entity.Property(e => e.Month).IsRequired(false);
        entity.Property(e => e.CropYear).IsRequired(false);
        entity.Property(e => e.SelectedColumns).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.CropOrder).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.HiddenCrops).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.SelectedMonths).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.SelectedYears).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.PrintLayout).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.SelectedBidSheetIds).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.PriceMode).HasMaxLength(10).IsRequired(false);
        entity.Property(e => e.ModifiedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.HasIndex(e => new { e.UserId, e.TradeUnitKey }).IsUnique().HasDatabaseName("UQ_BidSheetPreferences_User_TradeUnitKey");
        entity.HasIndex(e => e.UserId).HasDatabaseName("IX_BidSheetPreferences_UserId");
    }
}
