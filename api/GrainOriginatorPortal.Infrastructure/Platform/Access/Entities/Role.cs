namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// <c>dbo.Roles</c>: the roles this application defines (style guide §5.1.1). Roles are data: no code names
/// one, so adding a role is a row plus its grants, not a code change. Who holds a role lives in the
/// entitlements app and arrives in the token, so there is no user-to-role table here.
/// </summary>
public class Role
{
    public Guid Id { get; set; }

    /// <summary>
    /// Matches the role value in the access token. Never rename a role: everyone whose token carries the
    /// old name would lose its grants. Create the new one and retire the old one instead.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    /// <summary>What the role is for: one of <see cref="RoleKind"/>.</summary>
    public string Kind { get; set; } = RoleKind.Persona;

    /// <summary>True for the base role, <c>Admin</c>: it can't be deleted, and the grant editor can't change it.</summary>
    public bool IsSystem { get; set; }

    /// <summary>Set by the database when the row is inserted.</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>Who created it: a user's UPN from the grant editor, or the migration that seeded it.</summary>
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>Null until the row is changed; whoever changes it sets this and <see cref="ModifiedBy"/>.</summary>
    public DateTime? ModifiedAt { get; set; }

    public string? ModifiedBy { get; set; }

    public ICollection<RolePermission> Permissions { get; set; } = new List<RolePermission>();
    public ICollection<RoleSegment> Segments { get; set; } = new List<RoleSegment>();
}
