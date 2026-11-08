// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheetLocationLinks</c>.</summary>
public sealed class BidSheetLocationLinkConfiguration : IEntityTypeConfiguration<BidSheetLocationLink>
{
    public void Configure(EntityTypeBuilder<BidSheetLocationLink> entity)
    {
        entity.ToTable("BidSheetLocationLinks", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.BidSheetId).IsRequired();
        entity.Property(e => e.BidSheetLocationId).IsRequired();
        entity.Property(e => e.SortOrder).HasDefaultValue(0).IsRequired();
        // Same 200 as BidSheetLocations.Name -- it stands in for that value, so it must not be
        // able to hold a name the canonical column could not.
        entity.Property(e => e.DisplayName).HasMaxLength(200).IsRequired(false);
        entity.Property(e => e.AddedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.AddedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        // A location appears on a sheet once. The old JSON-array order had no such guard, so a
        // double-add put the same row on screen twice.
        entity.HasIndex(e => new { e.BidSheetId, e.BidSheetLocationId })
              .HasDatabaseName("UQ_BidSheetLocationLinks_Sheet_Location")
              .IsUnique();
        // RESTRICT, not cascade. The location delete path clears these links explicitly, after the
        // user has been shown how many sheets hold the elevator. Restricting means any OTHER path
        // that tries to remove a location fails loudly instead of quietly emptying someone's sheet.
        entity.HasOne(e => e.Location)
              .WithMany()
              .HasForeignKey(e => e.BidSheetLocationId)
              .OnDelete(DeleteBehavior.Restrict);
    }
}
