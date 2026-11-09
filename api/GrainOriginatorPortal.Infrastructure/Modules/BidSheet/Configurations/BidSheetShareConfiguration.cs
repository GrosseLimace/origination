// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Configurations;

/// <summary><c>dbo.BidSheetShares</c>.</summary>
public sealed class BidSheetShareConfiguration : IEntityTypeConfiguration<BidSheetShare>
{
    public void Configure(EntityTypeBuilder<BidSheetShare> entity)
    {
        entity.ToTable("BidSheetShares", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.BidSheetId).IsRequired();
        // 20 matches DailyRecapGroupMembers.MemberType -- the same discriminator values live in both,
        // and a column that could hold a longer string than the other invites them to diverge.
        entity.Property(e => e.MemberType).HasMaxLength(20).IsRequired();
        entity.Property(e => e.MemberId).HasMaxLength(256).IsRequired();
        entity.Property(e => e.MemberName).HasMaxLength(256).IsRequired(false);
        entity.Property(e => e.SharedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.SharedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        // Covers the visibility predicate's lookups, which filter on type + id together.
        entity.HasIndex(e => new { e.MemberType, e.MemberId }).HasDatabaseName("IX_BidSheetShares_Member");
        // Sharing with the same member twice is a no-op, not a second row. TYPE is part of the key
        // now: desk "2190" and a person who happens to be called "2190" are different members, and
        // without the type in the index the second would collide with the first.
        entity.HasIndex(e => new { e.BidSheetId, e.MemberType, e.MemberId })
              .HasDatabaseName("UQ_BidSheetShares_Sheet_Member")
              .IsUnique();
    }
}
