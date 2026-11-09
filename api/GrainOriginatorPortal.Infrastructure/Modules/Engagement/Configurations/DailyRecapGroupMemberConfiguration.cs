// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.DailyRecapGroupMembers</c>.</summary>
public sealed class DailyRecapGroupMemberConfiguration : IEntityTypeConfiguration<DailyRecapGroupMember>
{
    public void Configure(EntityTypeBuilder<DailyRecapGroupMember> entity)
    {
        entity.ToTable("DailyRecapGroupMembers", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.RecapGroupId).IsRequired();
        entity.Property(e => e.MemberType).HasMaxLength(20).IsRequired();
        entity.Property(e => e.MemberId).HasMaxLength(256).IsRequired();
        entity.Property(e => e.MemberName).HasMaxLength(256).IsRequired();
        entity.Property(e => e.Email).HasMaxLength(256).IsRequired(false);
        entity.HasIndex(e => e.RecapGroupId).HasDatabaseName("IX_DailyRecapGroupMembers_RecapGroupId");
    }
}
