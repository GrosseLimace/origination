// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access.Models.Responses;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Platform.Access.Controllers;

/// <summary>
/// Every role's grants in this environment. Each environment holds its own grants, so this is how to compare
/// QA with Prod, or check what Support holds, without database access.
/// </summary>
/// <remarks>
/// It reads the grant cache, so it shows what this instance enforces right now. A grant changed in the last
/// few minutes may not show yet.
/// </remarks>
[ApiController]
[Route("api/diagnostics/access-map")]
[RequirePermission(AppPermissions.Platform.DiagnosticsRead)]
[Produces("application/json")]
public sealed class AccessMapController(
    IRoleGrantCache grantCache,
    IOptionsMonitor<AccessOptions> options,
    IHostEnvironment environment) : ControllerBase
{
    [HttpGet]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(AccessMapResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<AccessMapResponse>> Get(CancellationToken cancellationToken)
    {
        var roles = (await grantCache.GetAsync(cancellationToken)).Roles.Values
            .OrderBy(r => r.Name, StringComparer.Ordinal)
            .ToArray();

        var heldByNoRole = new List<string>();
        var heldOnlyBySystemRoles = new List<string>();
        foreach (var permission in AppPermissions.All)
        {
            var holders = roles.Where(r => r.Permissions.Contains(permission)).ToArray();
            if (holders.Length == 0)
            {
                heldByNoRole.Add(permission);
            }
            else if (holders.All(r => r.IsSystem))
            {
                heldOnlyBySystemRoles.Add(permission);
            }
        }

        return Ok(new AccessMapResponse(
            environment.EnvironmentName,
            options.CurrentValue.DefaultRoles,
            roles.Select(r => new AccessMapRole(r.Name, r.Kind, r.IsSystem, Sorted(r.Permissions), Sorted(r.Segments))).ToArray(),
            heldByNoRole,
            heldOnlyBySystemRoles));
    }

    private static string[] Sorted(IEnumerable<string> values) => values.Order(StringComparer.Ordinal).ToArray();
}
