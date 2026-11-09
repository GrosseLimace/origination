// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Lists.Configurations;

/// <summary><c>dbo.QueryLibrary</c>.</summary>
public sealed class QueryLibraryItemConfiguration : IEntityTypeConfiguration<QueryLibraryItem>
{
    public void Configure(EntityTypeBuilder<QueryLibraryItem> entity)
    {
        entity.ToTable("QueryLibrary", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.Category).HasMaxLength(100).IsRequired();
        entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
        entity.Property(e => e.Description).HasMaxLength(500);
        entity.Property(e => e.QueryText).HasMaxLength(500).IsRequired();
        entity.Property(e => e.Tags).HasMaxLength(500);
        entity.Property(e => e.SortOrder).HasDefaultValue(0).IsRequired();
        entity.Property(e => e.IsActive).HasDefaultValue(true).IsRequired();
        entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()").IsRequired();
    }
}
