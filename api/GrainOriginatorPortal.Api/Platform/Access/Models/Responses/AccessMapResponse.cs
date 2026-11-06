namespace GrainOriginatorPortal.Api.Platform.Access.Models.Responses;

/// <summary>Every role's grants in one environment, as the instance that answered enforces them.</summary>
/// <param name="Environment">The environment that answered, such as <c>QA</c>.</param>
/// <param name="DefaultRoles">The roles a signed-in person gets when their token carries no persona role.</param>
/// <param name="Roles">Every role, sorted by name.</param>
/// <param name="HeldByNoRole">Catalog permissions no role holds, so nobody can use them. A grant migration was missed.</param>
/// <param name="HeldOnlyBySystemRoles">Catalog permissions only the break-glass role holds, so no everyday user can use them.</param>
public sealed record AccessMapResponse(
    string Environment,
    IReadOnlyList<string> DefaultRoles,
    IReadOnlyList<AccessMapRole> Roles,
    IReadOnlyList<string> HeldByNoRole,
    IReadOnlyList<string> HeldOnlyBySystemRoles);

/// <summary>One role and what it grants. The lists are sorted.</summary>
/// <param name="Name">The role's name, as the token carries it.</param>
/// <param name="Kind"><c>Persona</c>, <c>AddOn</c> or <c>Base</c>.</param>
/// <param name="IsSystem">True for the break-glass role.</param>
/// <param name="Permissions">The permissions the role grants.</param>
/// <param name="Segments">The customer segments the role can see.</param>
public sealed record AccessMapRole(
    string Name,
    string Kind,
    bool IsSystem,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<string> Segments);
