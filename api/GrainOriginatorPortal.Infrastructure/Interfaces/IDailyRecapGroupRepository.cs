using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Persistence for Daily Recap groups (Daily Digest). Reads and writes are both scoped by
/// <see cref="RecapGroupAccess"/> — the caller may see and edit a group they created OR are a member
/// of (person = UPN prefix, trade-unit = TU code, trade-unit-group = entitlements GroupId), all
/// resolved by the service and passed in. <see cref="DeleteAsync"/> is the one exception: it stays
/// scoped to CreatedBy, because deleting a group remains creator-only.</summary>
public interface IDailyRecapGroupRepository
{
    /// <summary>Groups the caller created OR is a member of, with members + CC emails, ordered by name.</summary>
    Task<List<DailyRecapGroup>> GetVisibleAsync(RecapGroupAccess access, CancellationToken cancellationToken);

    /// <summary>A single group the caller may see, with its members — the pre-edit state the service
    /// diffs a save against. Null if it doesn't exist or the caller can't see it.</summary>
    Task<DailyRecapGroup?> GetVisibleByIdAsync(int groupId, RecapGroupAccess access, CancellationToken cancellationToken);

    /// <summary>A group by id with NO access filter, for distinguishing "doesn't exist" (404) from
    /// "exists but you're not the creator" (403) on delete. Never return this to a caller.</summary>
    Task<DailyRecapGroup?> GetByIdAsync(int groupId, CancellationToken cancellationToken);

    /// <summary>Persists a new group (built by the caller, including its child member/CC rows).</summary>
    Task<DailyRecapGroup> AddAsync(DailyRecapGroup group, CancellationToken cancellationToken);

    /// <summary>Updates a group the caller may edit and replaces its children wholesale; returns the
    /// updated entity (members + CC included), or null if not found / not visible to the caller.</summary>
    Task<DailyRecapGroup?> UpdateAsync(
        int groupId,
        RecapGroupAccess access,
        RecapGroupValues values,
        CancellationToken cancellationToken);

    /// <summary>Toggles the Enabled flag on a group the caller may edit; returns the updated entity,
    /// or null if not found / not visible to the caller.</summary>
    Task<DailyRecapGroup?> SetEnabledAsync(int groupId, RecapGroupAccess access, bool enabled, CancellationToken cancellationToken);

    /// <summary>Deletes a group the caller CREATED (cascade removes member + CC rows). Returns whether
    /// a row was actually removed, so the service can tell a real delete from a lost race and never
    /// log an audit line for a delete that didn't happen. Creator-scoped as defence-in-depth: the
    /// service has already thrown 403 for a non-creator before reaching here.</summary>
    Task<bool> DeleteAsync(int groupId, string creatorUpn, CancellationToken cancellationToken);
}
