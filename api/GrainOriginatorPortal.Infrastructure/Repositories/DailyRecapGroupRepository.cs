using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class DailyRecapGroupRepository : IDailyRecapGroupRepository
{
    private readonly ApplicationDbContext _appContext;

    public DailyRecapGroupRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext;
    }

    public async Task<List<DailyRecapGroup>> GetVisibleAsync(
        string ownerUpn,
        string personId,
        IReadOnlyCollection<string> memberTradeUnitCodes,
        IReadOnlyCollection<string> memberGroupIds,
        CancellationToken cancellationToken)
    {
        // Groups the caller OWNS (CreatedBy = full UPN) plus ones they're a MEMBER of — directly as a
        // person (MemberId = UPN prefix), or via a trade unit / trade-unit group they belong to. Owned
        // groups are editable; member-only ones are shown read-only (IsOwner is decided in the service).
        return await _appContext.DailyRecapGroups
            .AsNoTracking()
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .Where(g => g.CreatedBy == ownerUpn
                || g.Members.Any(m =>
                    (m.MemberType == "person" && m.MemberId == personId)
                    || (m.MemberType == "trade-unit" && memberTradeUnitCodes.Contains(m.MemberId))
                    || (m.MemberType == "trade-unit-group" && memberGroupIds.Contains(m.MemberId))))
            .OrderBy(g => g.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<DailyRecapGroup> AddAsync(DailyRecapGroup group, CancellationToken cancellationToken)
    {
        _appContext.DailyRecapGroups.Add(group);
        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<DailyRecapGroup?> UpdateAsync(
        int groupId,
        string ownerUpn,
        string name,
        string deliveryMethod,
        string? teamsChannelEmail,
        List<DailyRecapGroupMember> members,
        List<DailyRecapGroupCcEmail> ccEmails,
        CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .FirstOrDefaultAsync(g => g.Id == groupId && g.CreatedBy == ownerUpn, cancellationToken);
        if (group == null) return null;

        group.Name = name;
        group.DeliveryMethod = deliveryMethod;
        group.TeamsChannelEmail = teamsChannelEmail;
        group.ModifiedBy = ownerUpn;
        group.ModifiedAt = DateTime.UtcNow;

        // Replace children wholesale — simplest correct way to reflect add/remove edits.
        _appContext.DailyRecapGroupMembers.RemoveRange(group.Members);
        _appContext.DailyRecapGroupCcEmails.RemoveRange(group.CcEmails);
        group.Members = members;
        group.CcEmails = ccEmails;

        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<DailyRecapGroup?> SetEnabledAsync(int groupId, string ownerUpn, bool enabled, CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .FirstOrDefaultAsync(g => g.Id == groupId && g.CreatedBy == ownerUpn, cancellationToken);
        if (group == null) return null;
        group.Enabled = enabled;
        group.ModifiedBy = ownerUpn;
        group.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task DeleteAsync(int groupId, string ownerUpn, CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.CreatedBy == ownerUpn, cancellationToken);
        if (group == null) return;
        // Cascade delete removes member + CC child rows.
        _appContext.DailyRecapGroups.Remove(group);
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
