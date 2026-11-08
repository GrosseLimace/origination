// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Entities;

namespace GrainOriginatorPortal.Infrastructure.Modules.Lists.Configurations;

/// <summary><c>dbo.SavedLists</c>.</summary>
public sealed class SavedListConfiguration : IEntityTypeConfiguration<SavedList>
{
    public void Configure(EntityTypeBuilder<SavedList> entity)
    {
        entity.ToTable("SavedLists", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.Name).HasColumnName("Name").HasMaxLength(100).IsRequired();
        entity.Property(e => e.Query).HasColumnName("Query").HasMaxLength(500).IsRequired();
        entity.Property(e => e.TradeUnits).HasColumnName("TradeUnits").HasMaxLength(500).IsRequired(false);
        entity.Property(e => e.Filters).HasColumnName("Filters").HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.IncludedCustomerIds).HasColumnName("IncludedCustomerIds").HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.ExcludedCustomerIds).HasColumnName("ExcludedCustomerIds").HasColumnType("nvarchar(max)").IsRequired(false);
        entity.Property(e => e.CreatedBy).HasColumnName("CreatedBy").HasMaxLength(255).IsRequired();
        entity.Property(e => e.CreatedAt).HasColumnName("CreatedAt").HasDefaultValueSql("GETUTCDATE()").IsRequired();
        entity.Property(e => e.ModifiedAt).HasColumnName("ModifiedAt").IsRequired(false);
        entity.Property(e => e.ModifiedBy).HasColumnName("ModifiedBy").HasMaxLength(255).IsRequired(false);
        entity.Property(e => e.IsActive).HasColumnName("IsActive").HasDefaultValue(true).IsRequired();
        entity.Property(e => e.AssignedTo).HasColumnName("AssignedTo").HasMaxLength(255).IsRequired(false);
    }
}
