namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>What the current caller may do and see, worked out once per request.</summary>
/// <param name="Roles">The roles that count: the token's roles found in <c>dbo.Roles</c>, plus any default roles.</param>
/// <param name="Permissions">The union of those roles' permissions.</param>
/// <param name="Segments">The union of those roles' customer segments.</param>
/// <param name="Modules">The modules with at least one held permission, such as <c>bid-sheet</c>. Drives the client's nav and preloading.</param>
/// <param name="UsesDefaultRoles">True when the token carried no persona role and the default roles were added.</param>
public sealed record UserAccess(
    IReadOnlySet<string> Roles,
    IReadOnlySet<string> Permissions,
    IReadOnlySet<string> Segments,
    IReadOnlySet<string> Modules,
    bool UsesDefaultRoles)
{
    /// <summary>No access at all: an anonymous caller.</summary>
    public static UserAccess None { get; } = new(
        new HashSet<string>(), new HashSet<string>(), new HashSet<string>(), new HashSet<string>(), UsesDefaultRoles: false);
}
