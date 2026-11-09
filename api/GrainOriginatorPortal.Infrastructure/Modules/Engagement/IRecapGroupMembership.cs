namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement;

/// <summary>
/// Which Daily Recap groups a caller is in. Bid Sheet needs it, because a sheet can be shared with a recap
/// group. It sits at the Engagement module's root, outside Repositories and Interfaces, because Bid Sheet builds
/// on Engagement and may use what is there.
/// </summary>
/// <remarks>
/// There is no fallback. If Engagement isn't registered, resolving the bid-sheet service fails loudly rather than
/// quietly hiding every sheet shared with a group.
/// </remarks>
public interface IRecapGroupMembership
{
    /// <summary>
    /// The ids of the recap groups the caller created or is a member of: by person, by one of their trade units,
    /// or by one of their entitlements trade-unit groups.
    /// </summary>
    Task<List<string>> GetCallerGroupIdsAsync(
        string callerUpn, string personId, IReadOnlyCollection<string> tradeUnitCodes,
        IReadOnlyCollection<string> groupIds, CancellationToken cancellationToken);
}
