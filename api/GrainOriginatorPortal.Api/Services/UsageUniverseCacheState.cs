namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Process-wide generation stamp for the Usage Dashboard's cached "user universe" (the resolved set
/// of users a view reports on). The universe is cached briefly because a single dashboard page load
/// resolves it once per endpoint — about a dozen times — and each resolution costs an entitlements
/// snapshot query plus a read of the excluded-users table.
/// <para>
/// Cache keys embed <see cref="Generation"/>, so bumping it makes every existing entry unreachable.
/// That's how an exclusion add/remove takes effect on the very next request instead of waiting out
/// the TTL; stale entries fall out of the cache on their own.
/// </para>
/// Registered as a singleton — the service that reads it is scoped.
/// </summary>
public class UsageUniverseCacheState
{
    private int _generation;

    public int Generation => Volatile.Read(ref _generation);

    public void Invalidate() => Interlocked.Increment(ref _generation);
}
