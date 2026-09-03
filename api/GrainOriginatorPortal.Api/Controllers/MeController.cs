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
    private readonly string[] _usageDashboardViewAll;

    public MeController(IConfiguration configuration)
    {
        _usageDashboardViewAll = configuration.GetSection("UsageDashboard:ViewAll").Get<string[]>() ?? [];
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

        // Synthetic role for the UsageDashboard:ViewAll list. Purely presentational — it tells the
        // SPA whether to render the manager dropdown. The server never reads it back: scoping is
        // re-derived from config on every request in UsageDashboardService, so forging this role
        // client-side changes the menu and nothing else.
        if (UsageDashboardAccess.CanViewAll(User, _usageDashboardViewAll)
            && !roles.Contains(UsageDashboardAccess.ViewAllRole))
        {
            roles = [.. roles, UsageDashboardAccess.ViewAllRole];
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
