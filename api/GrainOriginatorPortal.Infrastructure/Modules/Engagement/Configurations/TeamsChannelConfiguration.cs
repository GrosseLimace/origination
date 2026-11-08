// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.TeamsChannels</c>.</summary>
public sealed class TeamsChannelConfiguration : IEntityTypeConfiguration<TeamsChannel>
{
    public void Configure(EntityTypeBuilder<TeamsChannel> entity)
    {
        entity.ToTable("TeamsChannels", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.TeamId).HasMaxLength(100).IsRequired();
        entity.Property(e => e.TeamName).HasMaxLength(256).IsRequired();
        entity.Property(e => e.ChannelId).HasMaxLength(200).IsRequired();
        entity.Property(e => e.DisplayName).HasMaxLength(256).IsRequired();
        entity.Property(e => e.ChannelEmail).HasMaxLength(256).IsRequired();
        entity.Property(e => e.CreatedBy).HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
        // Registration is find-or-create keyed on the channel, so two people picking the same
        // channel must land on one row rather than racing to create duplicates.
        entity.HasIndex(e => e.ChannelId).IsUnique().HasDatabaseName("UX_TeamsChannels_ChannelId");
    }
}
