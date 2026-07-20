namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// The set of people who can actually sign in to the app — the transitive members of the Entra
/// access group (<c>AppAccess:GroupName</c>), keyed by short user name (UPN before the '@',
/// matching the Entitlements directory's UserId format). <see cref="Available"/> is false when
/// the group can't be read (Graph egress blocked, permission missing, not configured) — consumers
/// MUST fail open in that case and behave exactly as before this feature (deployed environments
/// can't reach Graph until IT grants land).
/// </summary>
public sealed record AppAccessSet
{
    public static readonly AppAccessSet Unavailable = new() { Available = false };

    public bool Available { get; init; }

    /// <summary>Short names (e.g. "CEgr") of enabled group members, case-insensitive.</summary>
    public IReadOnlySet<string> ShortNames { get; init; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>Display name per short name, from Entra — a fallback for people who have app
    /// access but no Entitlements row (e.g. admin accounts), case-insensitive keys.</summary>
    public IReadOnlyDictionary<string, string> DisplayNames { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Cached provider of <see cref="AppAccessSet"/>. Reads Graph on a cache miss (success cached
/// ~30 min, failure ~5 min so a blocked/misconfigured Graph is retried soon but never hammered),
/// single-flight so concurrent dashboard requests share one fetch, and self-timeboxed so a cold
/// cache against blocked egress can't hang a page.
/// </summary>
public interface IAppAccessService
{
    Task<AppAccessSet> GetAccessSetAsync(CancellationToken cancellationToken);
}
