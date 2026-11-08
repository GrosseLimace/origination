// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement.Configurations;

/// <summary><c>dbo.DailyRecapGroupCcEmails</c>.</summary>
public sealed class DailyRecapGroupCcEmailConfiguration : IEntityTypeConfiguration<DailyRecapGroupCcEmail>
{
    public void Configure(EntityTypeBuilder<DailyRecapGroupCcEmail> entity)
    {
        entity.ToTable("DailyRecapGroupCcEmails", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.RecapGroupId).IsRequired();
        entity.Property(e => e.Email).HasMaxLength(256).IsRequired();
        entity.HasIndex(e => e.RecapGroupId).HasDatabaseName("IX_DailyRecapGroupCcEmails_RecapGroupId");
    }
}
