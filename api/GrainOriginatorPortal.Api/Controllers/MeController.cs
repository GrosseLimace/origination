using System.Security.Claims;

using GrainOriginatorPortal.Api.Authorization;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Returns identity info for the current authenticated caller. Primary use case is
/// so the SPA can discover the user's app roles — the SPA's ID token does not carry
/// a `roles` claim (the SPA app registration has no app roles defined), but the API's
/// access token does, and that's the token this endpoint receives.
/// </summary>
[ApiController]
[Route("api/me")]
[Authorize]
[Produces("application/json")]
public class MeController : ControllerBase
{
    private readonly string[] _usageDashboardViewers;

    public MeController(IConfiguration configuration)
    {
        _usageDashboardViewers = configuration.GetSection("UsageDashboard:Viewers").Get<string[]>() ?? [];
    }

    [HttpGet]
    [ProducesResponseType(typeof(MeResponse), StatusCodes.Status200OK)]
    public ActionResult<MeResponse> Get()
    {
        // Try multiple claim names — Microsoft.Identity.Web sets RoleClaimType to
        // "roles" by default for v2 tokens, but the underlying JWT middleware can
        // remap `roles` to `ClaimTypes.Role` depending on MapInboundClaims config.
        // Checking all three sources handles whichever name actually populated.
        var identity = User.Identity as ClaimsIdentity;
        var roleClaimType = identity?.RoleClaimType ?? ClaimTypes.Role;
        var roles = User.FindAll(roleClaimType)
                        .Concat(User.FindAll("roles"))
                        .Concat(User.FindAll(ClaimTypes.Role))
                        .Select(c => c.Value)
                        .Distinct()
                        .ToArray();

        // Synthetic role for the UsageDashboard:Viewers config allowlist — lets non-admins on the
        // list reach the (server-enforced) usage dashboard. Never comes from the token; it exists
        // so the SPA's guard/nav can keep reading one roles array. See UsageDashboardAccess.
        if (UsageDashboardAccess.IsAllowlisted(User, _usageDashboardViewers)
            && !roles.Contains(UsageDashboardAccess.ViewerRole))
        {
            roles = [.. roles, UsageDashboardAccess.ViewerRole];
        }

        var userId = User.FindFirst("preferred_username")?.Value
                     ?? User.FindFirst("upn")?.Value
                     ?? User.Identity?.Name
                     ?? string.Empty;
        return Ok(new MeResponse { UserId = userId, Roles = roles });
    }

    public class MeResponse
    {
        public string UserId { get; set; } = string.Empty;
        public string[] Roles { get; set; } = [];
    }
}
