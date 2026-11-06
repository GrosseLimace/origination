// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Repositories;

/// <inheritdoc />
/// <remarks>
/// Three flat reads joined in memory rather than one query with two collections, which would multiply
/// every role's grants by its segments. The tables hold a few hundred rows at most.
/// </remarks>
public sealed class AccessGrantRepository : IAccessGrantRepository
{
    private readonly ApplicationDbContext _appContext;

    public AccessGrantRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<IReadOnlyList<RoleGrants>> GetAllAsync(CancellationToken cancellationToken)
    {
        var roles = await _appContext.Roles.AsNoTracking()
            .Select(r => new { r.Id, r.Name, r.Kind, r.IsSystem })
            .ToListAsync(cancellationToken);
        var permissions = await _appContext.RolePermissions.AsNoTracking()
            .Select(g => new { g.RoleId, g.PermissionId })
            .ToListAsync(cancellationToken);
        var segments = await _appContext.RoleSegments.AsNoTracking()
            .Select(s => new { s.RoleId, s.Segment })
            .ToListAsync(cancellationToken);

        var permissionsByRole = permissions.ToLookup(g => g.RoleId, g => g.PermissionId);
        var segmentsByRole = segments.ToLookup(s => s.RoleId, s => s.Segment);

        return roles
            .Select(r => new RoleGrants(
                r.Name,
                r.Kind,
                r.IsSystem,
                permissionsByRole[r.Id].ToHashSet(StringComparer.Ordinal),
                segmentsByRole[r.Id].ToHashSet(StringComparer.Ordinal)))
            .ToList();
    }
}
