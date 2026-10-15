using GrainOriginatorPortal.Mobile.Authorization;
using GrainOriginatorPortal.Mobile.Filters;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>
/// Base class for every mobile controller. The attributes here are the mobile surface's guarantees
/// and are inherited by MVC; a convention test asserts every controller in this assembly derives
/// from it:
/// <list type="bullet">
///   <item><c>[Authorize(Policy = MobileAccess)]</c> — mobile scope and client id (§3.2 scoped claims);</item>
///   <item><c>[ServiceFilter(MobileAuditActionFilter)]</c> — every mutation audited (§3.5);</item>
///   <item><c>[EnableRateLimiting("mobile")]</c> — per-user sliding window (§3.2 rate limiting);</item>
///   <item><c>[RequestSizeLimit(64 KB)]</c> — no mobile payload needs more (§3.2 input validation).</item>
/// </list>
/// </summary>
[ApiController]
[Authorize(Policy = MobileAccess.PolicyName)]
[ServiceFilter(typeof(MobileAuditActionFilter))]
[EnableRateLimiting(MobileAccess.RateLimitPolicyName)]
[RequestSizeLimit(MaxRequestBodyBytes)]
[Produces("application/json")]
public abstract class MobileControllerBase : ControllerBase
{
    public const string RoutePrefix = "api/mobile/v1";
    public const int MaxRequestBodyBytes = 64 * 1024;

    /// <summary>Stable per-user key (Entra object id) for idempotency; falls back to the identity name.</summary>
    protected string UserKey => MobileAccess.GetObjectId(User) ?? User.Identity?.Name ?? "anonymous";
}
