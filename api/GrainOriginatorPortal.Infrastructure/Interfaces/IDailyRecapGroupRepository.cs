using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for Daily Recap groups (Daily Digest). Create/update/delete/toggle are
/// scoped to the owning user (CreatedBy, the full UPN), supplied by the caller. The read returns
/// groups the caller owns OR is a member of — membership matched against the caller's entitlements
/// (person = UPN prefix, trade-unit = TU code, trade-unit-group = entitlements GroupId), all passed in.</summary>
public interface IDailyRecapGroupRepository
{
    /// <summary>Groups the caller created OR is a member of, with members + CC emails, ordered by name.</summary>
    Task<List<DailyRecapGroup>> GetVisibleAsync(
        string ownerUpn,
        string personId,
        IReadOnlyCollection<string> memberTradeUnitCodes,
        IReadOnlyCollection<string> memberGroupIds,
        CancellationToken cancellationToken);

    /// <summary>Persists a new group (built by the caller, including its child member/CC rows).</summary>
    Task<DailyRecapGroup> AddAsync(DailyRecapGroup group, CancellationToken cancellationToken);

    /// <summary>Updates an owned group's fields and replaces its children wholesale; returns the
    /// updated entity (members + CC included), or null if not found / not owned.</summary>
    Task<DailyRecapGroup?> UpdateAsync(
        int groupId,
        string ownerUpn,
        string name,
        string deliveryMethod,
        string? teamsChannelEmail,
        List<DailyRecapGroupMember> members,
        List<DailyRecapGroupCcEmail> ccEmails,
        CancellationToken cancellationToken);

    /// <summary>Toggles an owned group's Enabled flag; returns the updated entity, or null if not found / not owned.</summary>
    Task<DailyRecapGroup?> SetEnabledAsync(int groupId, string ownerUpn, bool enabled, CancellationToken cancellationToken);

    /// <summary>Deletes an owned group (cascade removes member + CC rows); no-op if not found / not owned.</summary>
    Task DeleteAsync(int groupId, string ownerUpn, CancellationToken cancellationToken);
}
