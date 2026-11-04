namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// <c>dbo.RolePermissions</c>: one row per permission a role holds. A SQL temporal table, so every past
/// grant is kept in <c>dbo.RolePermissionsHistory</c>.
/// </summary>
public class RolePermission
{
    public Guid RoleId { get; set; }
    public string PermissionId { get; set; } = string.Empty;

    /// <summary>Who granted it: a user's UPN from the grant editor, or the migration that seeded it.</summary>
    public string GrantedBy { get; set; } = string.Empty;

    /// <summary>Set by the database when the row is written.</summary>
    public DateTime GrantedAt { get; set; }

    public Role Role { get; set; } = null!;
    public Permission Permission { get; set; } = null!;
}
