// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Configurations;

/// <summary>
/// <c>dbo.RoleSegments</c>: the customer segments each role may see. A SQL temporal table, like
/// <c>dbo.RolePermissions</c>, and data like it.
/// </summary>
public sealed class RoleSegmentConfiguration : IEntityTypeConfiguration<RoleSegment>
{
    public void Configure(EntityTypeBuilder<RoleSegment> entity)
    {
        entity.ToTable("RoleSegments", schema: "dbo", table => table.IsTemporal(history =>
        {
            history.HasPeriodStart("ValidFrom");
            history.HasPeriodEnd("ValidTo");
            history.UseHistoryTable("RoleSegmentsHistory", "dbo");
        }));
        entity.HasKey(e => new { e.RoleId, e.Segment });
        entity.Property(e => e.Segment).HasMaxLength(50);
        entity.Property(e => e.GrantedBy).HasMaxLength(256).IsRequired();
        entity.Property(e => e.GrantedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.HasOne(e => e.Role).WithMany(r => r.Segments).HasForeignKey(e => e.RoleId).OnDelete(DeleteBehavior.Restrict);
    }
}
