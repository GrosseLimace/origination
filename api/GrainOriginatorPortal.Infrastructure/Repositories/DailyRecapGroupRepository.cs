using System.Linq.Expressions;
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

    /// <summary>The single definition of "this caller may see and edit this group": they created it
    /// (CreatedBy = full UPN), or they're a member — directly as a person (MemberId = UPN prefix), or
    /// via a trade unit / trade-unit group they belong to. Shared by the list read, the pre-edit
    /// read, and both write paths so edit rights can't drift from visibility. Kept private: nothing
    /// outside the repository should be composing EF predicates.
    ///
    /// An empty entitlement collection translates to <c>1=0</c>, so the degraded
    /// <see cref="RecapGroupAccess.CreatorOnly"/> context narrows this to CreatedBy alone.</summary>
    private static Expression<Func<DailyRecapGroup, bool>> VisibleTo(RecapGroupAccess access) =>
        g => g.CreatedBy == access.CallerUpn
            || g.Members.Any(m =>
                (m.MemberType == "person" && m.MemberId == access.PersonId)
                || (m.MemberType == "trade-unit" && access.TradeUnitCodes.Contains(m.MemberId))
                || (m.MemberType == "trade-unit-group" && access.GroupIds.Contains(m.MemberId)));

    public async Task<List<DailyRecapGroup>> GetVisibleAsync(RecapGroupAccess access, CancellationToken cancellationToken)
    {
        return await _appContext.DailyRecapGroups
            .AsNoTracking()
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .Where(VisibleTo(access))
            .OrderBy(g => g.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<DailyRecapGroup?> GetVisibleByIdAsync(int groupId, RecapGroupAccess access, CancellationToken cancellationToken)
    {
        return await _appContext.DailyRecapGroups
            .AsNoTracking()
            .Include(g => g.Members)
            .Where(VisibleTo(access))
            .FirstOrDefaultAsync(g => g.Id == groupId, cancellationToken);
    }

    public async Task<DailyRecapGroup?> GetByIdAsync(int groupId, CancellationToken cancellationToken)
    {
        // Deliberately unscoped — only for the service's 403-vs-404 decision on delete.
        return await _appContext.DailyRecapGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == groupId, cancellationToken);
    }

    public async Task<DailyRecapGroup> AddAsync(DailyRecapGroup group, CancellationToken cancellationToken)
    {
        _appContext.DailyRecapGroups.Add(group);
        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<DailyRecapGroup?> UpdateAsync(
        int groupId,
        RecapGroupAccess access,
        RecapGroupValues values,
        CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .Where(VisibleTo(access))
            .FirstOrDefaultAsync(g => g.Id == groupId, cancellationToken);
        if (group == null) return null;

        group.Name = values.Name;
        group.DeliveryMethod = values.DeliveryMethod;
        group.TeamsChannelEmail = values.TeamsChannelEmail;
        group.MentionsToChannel = values.MentionsToChannel;
        // The editor, who may not be the creator — CreatedBy is never reassigned.
        group.ModifiedBy = access.CallerUpn;
        group.ModifiedAt = DateTime.UtcNow;

        // Replace children wholesale — simplest correct way to reflect add/remove edits.
        _appContext.DailyRecapGroupMembers.RemoveRange(group.Members);
        _appContext.DailyRecapGroupCcEmails.RemoveRange(group.CcEmails);
        group.Members = values.Members;
        group.CcEmails = values.CcEmails;

        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<DailyRecapGroup?> SetEnabledAsync(int groupId, RecapGroupAccess access, bool enabled, CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .Include(g => g.Members)
            .Include(g => g.CcEmails)
            .Where(VisibleTo(access))
            .FirstOrDefaultAsync(g => g.Id == groupId, cancellationToken);
        if (group == null) return null;
        group.Enabled = enabled;
        group.ModifiedBy = access.CallerUpn;
        group.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);
        return group;
    }

    public async Task<bool> DeleteAsync(int groupId, string creatorUpn, CancellationToken cancellationToken)
    {
        var group = await _appContext.DailyRecapGroups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.CreatedBy == creatorUpn, cancellationToken);
        if (group == null) return false;
        // Cascade delete removes member + CC child rows.
        _appContext.DailyRecapGroups.Remove(group);
        await _appContext.SaveChangesAsync(cancellationToken);
        return true;
    }
}
