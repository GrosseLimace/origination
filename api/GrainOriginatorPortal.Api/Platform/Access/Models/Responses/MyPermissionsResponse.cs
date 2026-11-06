namespace GrainOriginatorPortal.Api.Platform.Access.Models.Responses;

/// <summary>What the signed-in caller may do and see. Every list is sorted.</summary>
/// <param name="UserId">The caller's sign-in name, such as <c>jane.doe@scoular.com</c>.</param>
/// <param name="Roles">The roles that count: the token's roles that exist here, plus any default roles.</param>
/// <param name="Permissions">Everything those roles grant, such as <c>notes:write</c>.</param>
/// <param name="Modules">The modules with at least one held permission, such as <c>bid-sheet</c>.</param>
/// <param name="Segments">The customer segments the caller may see, such as <c>Producer</c>.</param>
public sealed record MyPermissionsResponse(
    string UserId,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<string> Modules,
    IReadOnlyList<string> Segments);
