// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// Meets a <see cref="PermissionRequirement"/> when the caller holds the permission. Otherwise it leaves the
/// requirement unmet, which is enough for the policy to fail with a 403.
/// </summary>
/// <remarks>
/// <para><see cref="IPermissionService"/> works out access once per request, so a read permission on the
/// controller and a write permission on the action cost one lookup between them.</para>
/// <para><b>Fails closed.</b> If the grants have never loaded, the grant cache's 503 propagates and the
/// request is refused, never let through.</para>
/// </remarks>
public sealed class PermissionRequirementHandler(IPermissionService permissions, IHttpContextAccessor httpContextAccessor)
    : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        // IPermissionService answers for the request's caller. If someone ever asks about a different
        // principal (an AuthorizeAsync call with another user), refuse rather than answer for the wrong person.
        var request = httpContextAccessor.HttpContext;
        if (request is null || !ReferenceEquals(request.User, context.User))
        {
            return;
        }

        if (await permissions.HasPermissionAsync(requirement.Permission, request.RequestAborted))
        {
            context.Succeed(requirement);
        }
    }
}
