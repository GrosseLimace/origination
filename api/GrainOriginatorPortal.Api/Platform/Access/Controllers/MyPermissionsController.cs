// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access.Models.Responses;

namespace GrainOriginatorPortal.Api.Platform.Access.Controllers;

/// <summary>
/// What the signed-in caller may do and see. The client loads it once and decides its routes, nav, preloading
/// and controls from it.
/// </summary>
/// <remarks>
/// Needs no permission: anyone signed in may ask about themselves. It only reports; the API checks every
/// request itself, whatever the client shows.
/// </remarks>
[ApiController]
[Route("api/me/permissions")]
[Authorize]
[Produces("application/json")]
public sealed class MyPermissionsController(IPermissionService permissions) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(MyPermissionsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<MyPermissionsResponse>> Get(CancellationToken cancellationToken)
    {
        var access = await permissions.GetAccessAsync(cancellationToken);
        var userId = User.FindFirst("preferred_username")?.Value
                     ?? User.FindFirst("upn")?.Value
                     ?? User.Identity?.Name
                     ?? string.Empty;

        return Ok(new MyPermissionsResponse(
            userId,
            Sorted(access.Roles),
            Sorted(access.Permissions),
            Sorted(access.Modules),
            Sorted(access.Segments)));
    }

    private static string[] Sorted(IEnumerable<string> values) => values.Order(StringComparer.Ordinal).ToArray();
}
