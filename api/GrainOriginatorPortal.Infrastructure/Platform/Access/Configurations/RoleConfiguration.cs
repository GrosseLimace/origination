// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Configurations;

/// <summary>
/// <c>dbo.Roles</c>. Roles are data, not code: no <c>HasData</c> here, because the grant editor creates and
/// retires roles at run time and a later migration must not overwrite those edits. Migrations insert the
/// first rows (<c>AddAccessGrants</c>).
/// </summary>
public sealed class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> entity)
    {
        entity.ToTable("Roles", schema: "dbo", table => table.HasCheckConstraint(
            "CK_Roles_Kind", $"[Kind] IN ({string.Join(", ", RoleKind.All.Select(k => $"'{k}'"))})"));
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Name).HasMaxLength(100).IsRequired();
        entity.HasIndex(e => e.Name).IsUnique();
        entity.Property(e => e.Description).HasMaxLength(500).IsRequired();
        entity.Property(e => e.Kind).HasMaxLength(20).IsRequired();
        entity.Property(e => e.IsSystem).IsRequired();
        entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();
        entity.Property(e => e.UpdatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();

        // Restricted, like every delete in the access tables: a role with grants can't be deleted until
        // its grants are removed deliberately (style guide §9.2).
        entity.HasOne<Role>().WithMany().HasForeignKey(e => e.ParentRoleId).OnDelete(DeleteBehavior.Restrict);
    }
}
