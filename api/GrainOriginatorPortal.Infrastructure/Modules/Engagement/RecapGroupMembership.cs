// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement;

/// <summary>
/// The recap groups a caller is in, for Bid Sheet's sharing. Mirrors DailyRecapGroupRepository's own visibility
/// rule (created it, or a member by person / trade-unit / trade-unit-group), so "groups I'm in" means the same
/// thing on both screens.
/// </summary>
public sealed class RecapGroupMembership(ApplicationDbContext appContext) : IRecapGroupMembership
{
    public async Task<List<string>> GetCallerGroupIdsAsync(
        string callerUpn, string personId, IReadOnlyCollection<string> tradeUnitCodes,
        IReadOnlyCollection<string> groupIds, CancellationToken cancellationToken)
    {
        var ids = await appContext.DailyRecapGroups.AsNoTracking()
            .Where(g => g.CreatedBy == callerUpn
                     || g.Members.Any(m =>
                            (m.MemberType == "person" && m.MemberId == personId)
                         || (m.MemberType == "trade-unit" && tradeUnitCodes.Contains(m.MemberId))
                         || (m.MemberType == "trade-unit-group" && groupIds.Contains(m.MemberId))))
            .Select(g => g.Id)
            .ToListAsync(cancellationToken);
        return ids.Select(id => id.ToString()).ToList();
    }
}
