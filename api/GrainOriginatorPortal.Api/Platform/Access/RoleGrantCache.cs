// Microsoft namespaces
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>
/// Keeps the whole access map in memory on each instance and reloads it every
/// <see cref="AccessOptions.GrantCacheDuration"/>, so a grant change takes effect within that (plan §4.3).
/// </summary>
/// <remarks>
/// <para><b>Fails closed, but not on a blip.</b> If a reload fails and an earlier copy exists, that copy is
/// served and the reload is retried after <see cref="RetryAfterFailure"/>. Only a failure with no copy at
/// all, such as the first load after a restart, throws: a 503, as <c>UserEntitlementService</c> does.</para>
/// <para><b>One reload at a time.</b> While one request reloads, the others are served the current copy
/// rather than waiting on the database. Only the very first load makes callers wait.</para>
/// </remarks>
public sealed class RoleGrantCache : IRoleGrantCache, IDisposable
{
    public static readonly TimeSpan RetryAfterFailure = TimeSpan.FromSeconds(30);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptionsMonitor<AccessOptions> _options;
    private readonly TimeProvider _time;
    private readonly ILogger<RoleGrantCache> _logger;
    private readonly SemaphoreSlim _reload = new(1, 1);

    private volatile Cached? _cached;

    public RoleGrantCache(
        IServiceScopeFactory scopeFactory,
        IOptionsMonitor<AccessOptions> options,
        TimeProvider time,
        ILogger<RoleGrantCache> logger)
    {
        _scopeFactory = scopeFactory;
        _options = options;
        _time = time;
        _logger = logger;
    }

    public async Task<AccessGrants> GetAsync(CancellationToken cancellationToken)
    {
        var cached = _cached;
        if (cached is not null && _time.GetUtcNow() < cached.ReloadAfter)
        {
            return cached.Grants;
        }

        // A reload is due. With a copy in hand, don't queue behind another request's reload.
        if (cached is not null)
        {
            if (!await _reload.WaitAsync(0, cancellationToken))
            {
                return cached.Grants;
            }
        }
        else
        {
            await _reload.WaitAsync(cancellationToken);
        }

        try
        {
            cached = _cached;
            if (cached is not null && _time.GetUtcNow() < cached.ReloadAfter)
            {
                return cached.Grants;
            }

            return await ReloadAsync(cached, cancellationToken);
        }
        finally
        {
            _reload.Release();
        }
    }

    private async Task<AccessGrants> ReloadAsync(Cached? previous, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var rows = await scope.ServiceProvider.GetRequiredService<IAccessGrantRepository>().GetAllAsync(cancellationToken);
            var grants = AccessGrants.From(rows, out var unknownPermissions);

            if (unknownPermissions.Count > 0)
            {
                _logger.LogWarning(
                    "Grants name permissions this build doesn't know; they grant nothing [{ErrorCode}]: {Permissions}",
                    "ACCESS_UNKNOWN_PERMISSIONS", unknownPermissions);
            }

            _cached = new Cached(grants, _time.GetUtcNow() + _options.CurrentValue.GrantCacheDuration);
            _logger.LogInformation("Loaded the access map: {RoleCount} roles", grants.Roles.Count);
            return grants;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (previous is not null)
            {
                _logger.LogWarning(ex,
                    "Couldn't reload the access map; serving the last copy and retrying in {RetrySeconds} s [{ErrorCode}]",
                    RetryAfterFailure.TotalSeconds, "ACCESS_GRANTS_STALE");
                _cached = previous with { ReloadAfter = _time.GetUtcNow() + RetryAfterFailure };
                return previous.Grants;
            }

            _logger.LogError(ex, "Couldn't load the access map and have no copy; denying access [{ErrorCode}]",
                "ACCESS_GRANTS_UNAVAILABLE");
            throw new InfrastructureException(
                "Access information is temporarily unavailable. Please try again shortly.",
                "ACCESS_GRANTS_UNAVAILABLE",
                ex);
        }
    }

    public void Dispose() => _reload.Dispose();

    private sealed record Cached(AccessGrants Grants, DateTimeOffset ReloadAfter);
}
