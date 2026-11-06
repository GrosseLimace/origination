namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

/// <summary>
/// The kinds of role (plan §7.3), stored in <c>dbo.Roles.Kind</c>. A check constraint limits the column
/// to these values.
/// </summary>
public static class RoleKind
{
    /// <summary>
    /// Decides what you see: module reads, personal writes and a customer segment. A token with no persona
    /// role gets the temporary default roles until the entitlements app issues personas (plan §7.1).
    /// </summary>
    public const string Persona = "Persona";

    /// <summary>Decides what you may do with what your persona shows you. Holds no segments.</summary>
    public const string AddOn = "AddOn";

    /// <summary>The style guide's base role, <c>Admin</c>: every permission and every segment.</summary>
    public const string Base = "Base";

    /// <summary>
    /// A machine caller, not a person, such as the BarChart pipeline. Its app-only token carries an app role
    /// named like the row. It never gets the default roles and holds no segments.
    /// </summary>
    public const string Machine = "Machine";

    public static IReadOnlyList<string> All { get; } = [Persona, AddOn, Base, Machine];
}
