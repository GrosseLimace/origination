// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Configurations;

/// <summary>
/// <c>dbo.RolePermissions</c>: a SQL temporal table, so every past grant is kept in
/// <c>dbo.RolePermissionsHistory</c>. Grants are data: no <c>HasData</c>, for the same reason as roles.
/// </summary>
public sealed class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> entity)
    {
        entity.ToTable("RolePermissions", schema: "dbo", table => table.IsTemporal(history =>
        {
            history.HasPeriodStart("ValidFrom");
            history.HasPeriodEnd("ValidTo");
            history.UseHistoryTable("RolePermissionsHistory", "dbo");
        }));
        entity.HasKey(e => new { e.RoleId, e.PermissionId });
        entity.Property(e => e.PermissionId).HasMaxLength(150);
        entity.Property(e => e.CreatedBy).HasMaxLength(256).IsRequired();
        entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").IsRequired();

        // Restricted: removing a role or a permission that is still granted fails, so whoever removes it
        // deletes its grants deliberately (style guide §9.2).
        entity.HasOne(e => e.Role).WithMany(r => r.Permissions).HasForeignKey(e => e.RoleId).OnDelete(DeleteBehavior.Restrict);
        entity.HasOne(e => e.Permission).WithMany().HasForeignKey(e => e.PermissionId).OnDelete(DeleteBehavior.Restrict);
    }
}
