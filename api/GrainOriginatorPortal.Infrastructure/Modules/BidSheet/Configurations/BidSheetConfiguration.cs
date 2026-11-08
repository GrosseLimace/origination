// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheets</c>.</summary>
public sealed class BidSheetConfiguration : IEntityTypeConfiguration<Entities.BidSheet>
{
    public void Configure(EntityTypeBuilder<Entities.BidSheet> entity)
    {
        entity.ToTable("BidSheets", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
        entity.Property(e => e.OwnerUserId).HasMaxLength(256).IsRequired();
        entity.Property(e => e.CropOrder).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.HiddenCrops).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.SelectedMonths).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.SelectedYears).HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedBy).HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.ModifiedAt).IsRequired(false);
        entity.HasIndex(e => e.OwnerUserId).HasDatabaseName("IX_BidSheets_OwnerUserId");
        // One name per owner. Neither precedent constrains this and both suffer for it -- two
        // groups called "West Team" are indistinguishable in a picker that resolves by id.
        entity.HasIndex(e => new { e.OwnerUserId, e.Name })
              .HasDatabaseName("UQ_BidSheets_Owner_Name")
              .IsUnique();
        entity.HasMany(e => e.Shares).WithOne(sh => sh.BidSheet).HasForeignKey(sh => sh.BidSheetId).OnDelete(DeleteBehavior.Cascade);
        entity.HasMany(e => e.Locations).WithOne(l => l.BidSheet).HasForeignKey(l => l.BidSheetId).OnDelete(DeleteBehavior.Cascade);
    }
}
