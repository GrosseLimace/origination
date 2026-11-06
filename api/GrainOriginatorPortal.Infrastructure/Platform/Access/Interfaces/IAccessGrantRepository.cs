namespace GrainOriginatorPortal.Infrastructure.Platform.Access.Interfaces;

/// <summary>
/// Reads the whole access map: every role with its grants and segments. It is small and the same for
/// everyone, so the API caches it per instance rather than querying per user (plan §4.3).
/// </summary>
public interface IAccessGrantRepository
{
    Task<IReadOnlyList<RoleGrants>> GetAllAsync(CancellationToken cancellationToken);
}
