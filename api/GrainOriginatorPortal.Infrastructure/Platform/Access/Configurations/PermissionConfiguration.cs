// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Configurations;

/// <summary>
/// <c>dbo.Permissions</c>, seeded from <see cref="AppPermissions"/> through <c>HasData</c>. Every permission is
/// checked by an endpoint, so the catalog is code and only migrations write this table. Adding a permission
/// without a migration is a pending model change, which <c>AccessModelTests</c> catches.
/// </summary>
public sealed class PermissionConfiguration : IEntityTypeConfiguration<Permission>
{
    public void Configure(EntityTypeBuilder<Permission> entity)
    {
        entity.ToTable("Permissions", schema: "dbo");
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).HasMaxLength(150).ValueGeneratedNever();
        entity.Property(e => e.Resource).HasMaxLength(100).IsRequired();
        entity.Property(e => e.Action).HasMaxLength(50).IsRequired();
        entity.Property(e => e.Scope).HasMaxLength(50).IsRequired();
        entity.Property(e => e.ModuleId).HasMaxLength(50).IsRequired();
        entity.Property(e => e.Description).HasMaxLength(500);
        // ValueGeneratedOnAdd is implied by the SQL default on SQL Server, but the in-memory provider used in
        // tests ignores SQL defaults and would reject the seed rows for leaving CreatedAt out.
        entity.Property(e => e.CreatedAt).HasPrecision(3).HasDefaultValueSql("SYSUTCDATETIME()").ValueGeneratedOnAdd().IsRequired();
        entity.Property(e => e.CreatedBy).HasMaxLength(256).IsRequired();
        entity.Property(e => e.ModifiedAt).HasPrecision(3);
        entity.Property(e => e.ModifiedBy).HasMaxLength(256);
        entity.HasData(AppPermissions.All.Select(SeedRow).ToArray());
    }

    // An anonymous object, not an entity: HasData must not see navigation properties. CreatedAt is left to
    // the database default, so a permission records when the migration that adds it ran.
    private static object SeedRow(string permission)
    {
        var parts = permission.Split(':');
        return new
        {
            Id = permission,
            Resource = parts[0],
            Action = parts[1],
            Scope = parts.Length > 2 ? parts[2] : Permission.GlobalScope,
            ModuleId = AppPermissions.ModuleOf[permission],
            Description = (string?)null,
            CreatedBy = Permission.SeededBy,
        };
    }
}
