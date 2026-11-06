namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

/// <summary>One role as the access map sees it: what it is, and what it grants.</summary>
/// <param name="Name">Matches the role value in the access token.</param>
/// <param name="Kind">One of <c>RoleKind</c>: <c>Persona</c>, <c>AddOn</c> or <c>Base</c>.</param>
/// <param name="IsSystem">True for the base role, <c>Admin</c>.</param>
/// <param name="Permissions">The permission strings the role holds.</param>
/// <param name="Segments">The customer segments the role may see.</param>
public sealed record RoleGrants(
    string Name,
    string Kind,
    bool IsSystem,
    IReadOnlySet<string> Permissions,
    IReadOnlySet<string> Segments);
