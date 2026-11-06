// System namespaces
using System.Security.Claims;

// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Entities;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <inheritdoc />
/// <remarks>
/// <para><b>How a caller's access is worked out</b> (plan §4.3 and §7.1):</para>
/// <list type="number">
///   <item><description>Read the token's roles. A role with no row in <c>dbo.Roles</c> grants nothing and is logged.</description></item>
///   <item><description>If the caller is a signed-in person and none of their roles is a persona, add
///   <see cref="AccessOptions.DefaultRoles"/> until the entitlements app issues personas. App-only tokens,
///   such as the BarChart pipeline's, never get defaults.</description></item>
///   <item><description>Union the roles' permissions and segments. Roles only add.</description></item>
/// </list>
/// <para><b>Logged once per user per hour,</b> not per request: unknown roles, use of the default roles
/// (today that is everyone), and a production request carrying the system role. Until Phase 6 moves
/// today's Super Users off <c>Admin</c>, a per-request warning would bury the one that matters.</para>
/// <para>Scoped, so the result is kept for the request and never longer: a removed role or grant applies
/// on the caller's next request after the grant cache reloads.</para>
/// </remarks>
public sealed class PermissionService : IPermissionService
{
    private static readonly TimeSpan LogOncePer = TimeSpan.FromHours(1);

    // A delegated (user) token carries the scopes it was granted; an app-only token carries none.
    private static readonly string[] ScopeClaimTypes = ["scp", "http://schemas.microsoft.com/identity/claims/scope"];

    private readonly IUserRoleSource _roleSource;
    private readonly IRoleGrantCache _grantCache;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IOptionsMonitor<AccessOptions> _options;
    private readonly IHostEnvironment _environment;
    private readonly IMemoryCache _memoryCache;
    private readonly ILogger<PermissionService> _logger;

    private UserAccess? _access;

    public PermissionService(
        IUserRoleSource roleSource,
        IRoleGrantCache grantCache,
        IHttpContextAccessor httpContextAccessor,
        IOptionsMonitor<AccessOptions> options,
        IHostEnvironment environment,
        IMemoryCache memoryCache,
        ILogger<PermissionService> logger)
    {
        _roleSource = roleSource;
        _grantCache = grantCache;
        _httpContextAccessor = httpContextAccessor;
        _options = options;
        _environment = environment;
        _memoryCache = memoryCache;
        _logger = logger;
    }

    public async Task<UserAccess> GetAccessAsync(CancellationToken cancellationToken = default) =>
        _access ??= await ResolveAsync(cancellationToken);

    public async Task<bool> HasPermissionAsync(string permission, CancellationToken cancellationToken = default) =>
        (await GetAccessAsync(cancellationToken)).Permissions.Contains(permission);

    private async Task<UserAccess> ResolveAsync(CancellationToken cancellationToken)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user is null || !user.Identities.Any(i => i.IsAuthenticated))
        {
            return UserAccess.None;
        }

        var grants = await _grantCache.GetAsync(cancellationToken);
        var userId = UserIdOf(user);
        var roles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var unknownRoles = new List<string>();
        foreach (var name in _roleSource.GetRoles(user))
        {
            if (grants.Roles.TryGetValue(name, out var role))
            {
                roles.Add(role.Name);
            }
            else
            {
                unknownRoles.Add(name);
            }
        }

        if (unknownRoles.Count > 0 && FirstTimeThisHour($"access:unknown-roles:{userId}"))
        {
            _logger.LogInformation(
                "Token roles with no row in dbo.Roles grant nothing [{ErrorCode}]: {UserId} holds {UnknownRoles}",
                "ACCESS_UNKNOWN_ROLES", userId, unknownRoles.Order(StringComparer.Ordinal).ToArray());
        }

        var usesDefaultRoles = false;
        var defaultRoles = _options.CurrentValue.DefaultRoles;
        if (defaultRoles.Length > 0 && IsSignedInPerson(user) && !roles.Any(r => grants.Roles[r].Kind == RoleKind.Persona))
        {
            usesDefaultRoles = true;
            foreach (var name in defaultRoles)
            {
                if (grants.Roles.TryGetValue(name, out var role))
                {
                    roles.Add(role.Name);
                }
                else if (FirstTimeThisHour($"access:missing-default:{name}"))
                {
                    _logger.LogWarning(
                        "Default role {Role} has no row in dbo.Roles, so it grants nothing [{ErrorCode}]",
                        name, "ACCESS_DEFAULT_ROLE_MISSING");
                }
            }

            if (FirstTimeThisHour($"access:default-roles:{userId}"))
            {
                _logger.LogInformation(
                    "No persona role on the token; adding the default roles [{ErrorCode}]: {UserId} gets {DefaultRoles}",
                    "ACCESS_DEFAULT_ROLES", userId, defaultRoles);
            }
        }

        if (_environment.IsProduction()
            && roles.Any(r => grants.Roles[r].IsSystem)
            && FirstTimeThisHour($"access:system-role:{userId}"))
        {
            _logger.LogWarning(
                "A production request carries the system role [{ErrorCode}] [{ErrorCategory}]: {UserId} holds {Roles}. Only the break-glass account should.",
                "ACCESS_SYSTEM_ROLE_IN_PRODUCTION", "Security", userId,
                roles.Where(r => grants.Roles[r].IsSystem).ToArray());
        }

        var permissions = roles.SelectMany(r => grants.Roles[r].Permissions).ToHashSet(StringComparer.Ordinal);
        return new UserAccess(
            roles,
            permissions,
            roles.SelectMany(r => grants.Roles[r].Segments).ToHashSet(StringComparer.Ordinal),
            permissions.Select(p => AppPermissions.ModuleOf[p]).ToHashSet(StringComparer.Ordinal),
            usesDefaultRoles);
    }

    private static bool IsSignedInPerson(ClaimsPrincipal user) =>
        ScopeClaimTypes.Any(type => user.FindFirst(type) is { Value.Length: > 0 });

    // The short name the usage tables and other logs use; the object id when the token has no UPN.
    private static string UserIdOf(ClaimsPrincipal user)
    {
        var upn = user.FindFirst("preferred_username")?.Value ?? user.FindFirst("upn")?.Value;
        if (!string.IsNullOrWhiteSpace(upn))
        {
            return upn.Split('@')[0];
        }

        return user.FindFirst("oid")?.Value
            ?? user.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
            ?? "unknown";
    }

    private bool FirstTimeThisHour(string key)
    {
        if (_memoryCache.TryGetValue(key, out _))
        {
            return false;
        }

        // Size is required: the app's IMemoryCache has a SizeLimit.
        _memoryCache.Set(key, true, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = LogOncePer, Size = 1 });
        return true;
    }
}
