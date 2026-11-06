// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// The caller must hold <see cref="Permission"/>. Each permission policy, such as <c>Permission:notes:write</c>,
/// has one.
/// </summary>
public sealed record PermissionRequirement(string Permission) : IAuthorizationRequirement;
