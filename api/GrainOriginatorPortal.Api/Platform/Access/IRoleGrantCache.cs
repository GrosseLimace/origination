namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>Every role's grants and segments, cached per instance (plan §4.3).</summary>
public interface IRoleGrantCache
{
    /// <summary>
    /// The current access map. Throws <see cref="Exceptions.InfrastructureException"/> (503) only when the
    /// grants can't be loaded and no earlier copy exists: access fails closed.
    /// </summary>
    Task<AccessGrants> GetAsync(CancellationToken cancellationToken);
}
