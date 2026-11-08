namespace GrainOriginatorPortal.Infrastructure.Platform.Extensions;

/// <summary>
/// Which Daily Recap groups a caller is in. Bid Sheet needs it, because a sheet can be shared with a recap
/// group, but recap groups belong to the Engagement module, which implements it. Declared here, outside both
/// modules, so that neither depends on the other.
/// </summary>
/// <remarks>
/// There is no fallback. If no module provides this, resolving the bid-sheet service fails loudly rather than
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
