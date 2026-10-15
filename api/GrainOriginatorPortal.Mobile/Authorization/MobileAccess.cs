using System.Security.Claims;

namespace GrainOriginatorPortal.Mobile.Authorization;

/// <summary>
/// Claim logic behind the two policies that keep the mobile and desktop surfaces apart:
/// <list type="bullet">
///   <item><see cref="PolicyName"/> (MobileAccess): the token carries a configured mobile scope AND,
///   when client ids are configured, was issued to a mobile client registration.</item>
///   <item><see cref="DesktopPolicyName"/> (DesktopAccess): applied by convention to every controller
///   outside the mobile assembly; denies any token that looks like a mobile token, so a mobile
///   token can never reach the 128-endpoint desktop surface (SEC-ARCH-BURDI-001 §3.2, scoped claims).
///   Off when <see cref="MobileOptions.SharedSignIn"/> is on (Grain Vision's model, user 2026-10-15): one sign-in serves both.</item>
/// </list>
/// Pure functions over <see cref="ClaimsPrincipal"/> so they are unit-testable without a host.
/// </summary>
public static class MobileAccess
{
    public const string PolicyName = "MobileAccess";
    public const string DesktopPolicyName = "DesktopAccess";
    public const string RateLimitPolicyName = "mobile";

    private static readonly string[] ScopeClaimTypes =
        ["scp", "http://schemas.microsoft.com/identity/claims/scope"];

    private static readonly string[] ClientAppIdClaimTypes =
        ["azp", "appid"];

    private static readonly string[] ObjectIdClaimTypes =
        ["oid", "http://schemas.microsoft.com/identity/claims/objectidentifier"];

    /// <summary>All delegated scopes on the token (space-separated in Entra v2 tokens).</summary>
    public static IReadOnlySet<string> GetScopes(ClaimsPrincipal user)
    {
        var scopes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var type in ScopeClaimTypes)
        {
            foreach (var claim in user.FindAll(type))
            {
                foreach (var scope in claim.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    scopes.Add(scope);
                }
            }
        }
        return scopes;
    }

    /// <summary>The client application the token was issued to (<c>azp</c> in v2 tokens, <c>appid</c> in v1).</summary>
    public static string? GetClientAppId(ClaimsPrincipal user)
    {
        foreach (var type in ClientAppIdClaimTypes)
        {
            var value = user.FindFirst(type)?.Value;
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return null;
    }

    /// <summary>The user's Entra object id — the stable per-user key for rate limiting and idempotency.</summary>
    public static string? GetObjectId(ClaimsPrincipal user)
    {
        foreach (var type in ObjectIdClaimTypes)
        {
            var value = user.FindFirst(type)?.Value;
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return null;
    }

    public static bool HasMobileScope(ClaimsPrincipal user, IReadOnlyCollection<string> requiredScopes)
        => requiredScopes.Count > 0 && GetScopes(user).Overlaps(requiredScopes);

    public static bool IsAllowedClient(ClaimsPrincipal user, IReadOnlyCollection<string> allowedClientAppIds)
    {
        if (allowedClientAppIds.Count == 0) return true; // not yet configured; scope alone decides
        var clientId = GetClientAppId(user);
        return clientId is not null && allowedClientAppIds.Contains(clientId, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// True when the token should be treated as a mobile token for the purpose of keeping it OFF
    /// the desktop surface: either it carries a mobile scope, or it was issued to a mobile client.
    /// </summary>
    public static bool IsMobileToken(ClaimsPrincipal user, MobileOptions options)
    {
        if (HasMobileScope(user, options.RequiredScopes)) return true;
        if (options.AllowedClientAppIds.Length == 0) return false;
        var clientId = GetClientAppId(user);
        return clientId is not null && options.AllowedClientAppIds.Contains(clientId, StringComparer.OrdinalIgnoreCase);
    }

    public static bool CanAccessMobileSurface(ClaimsPrincipal user, MobileOptions options)
        => user.Identity?.IsAuthenticated == true
           && HasMobileScope(user, options.RequiredScopes)
           && IsAllowedClient(user, options.AllowedClientAppIds);

    /// <summary>
    /// With <see cref="MobileOptions.SharedSignIn"/> (Grain Vision's model) the phone and the desktop use the same token, so
    /// there is no "mobile-only" token to keep out; the private App Service behind APIM limits what the internet can reach.
    /// </summary>
    public static bool CanAccessDesktopSurface(ClaimsPrincipal user, MobileOptions options)
        => user.Identity?.IsAuthenticated == true
           && (options.SharedSignIn || !IsMobileToken(user, options));
}
