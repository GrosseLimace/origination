namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// <c>dbo.Permissions</c>: generated from <see cref="AppPermissions"/> through EF <c>HasData</c>, so only
/// migrations write it (style guide §5.1.2).
/// </summary>
/// <remarks>
/// The key is the permission string itself, such as <c>notes:write</c>, rather than the guide's Guid. The
/// catalog's strings are already unique, the seed stays deterministic, and grant rows read plainly.
/// <see cref="Resource"/>, <see cref="Action"/> and <see cref="Scope"/> are its parts, for reporting.
/// </remarks>
public class Permission
{
    public string Id { get; set; } = string.Empty;
    public string Resource { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;

    /// <summary><c>global</c> when the permission string names no scope, as the style guide defaults it.</summary>
    public string Scope { get; set; } = GlobalScope;

    /// <summary>The module that owns the permission, such as <c>bid-sheet</c>.</summary>
    public string ModuleId { get; set; } = string.Empty;

    public string? Description { get; set; }

    public const string GlobalScope = "global";
}
