using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Decides which job-title sightings in a usage batch are worth writing to dbo.UserJobTitle.
/// Every request carries the claim, so writing it through would be one upsert per request. This
/// remembers the last title seen per user and surfaces only first sightings (since start-up) and
/// changes; the repository then compares against the stored row, so a restart costs one read per
/// user, not a write.
/// <para>
/// Not thread-safe by design — it is owned by the single usage-tracking loop.
/// </para>
/// </summary>
public sealed class JobTitleChangeTracker
{
    private readonly Dictionary<string, string?> _lastSeen = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>One observation per user whose title is new or changed in this batch. When a user
    /// appears more than once the latest sighting wins, and the memory is updated as a side effect.</summary>
    public List<UserJobTitleObservation> Observe(IEnumerable<UserActivityRecord> records)
    {
        var changed = new Dictionary<string, UserJobTitleObservation>(StringComparer.OrdinalIgnoreCase);
        foreach (var record in records.OrderBy(r => r.Timestamp))
        {
            if (string.IsNullOrEmpty(record.UserId)) continue;

            // Ordinal, matching the repository: a casing-only edit in the directory still counts.
            if (_lastSeen.TryGetValue(record.UserId, out var previous)
                && string.Equals(previous, record.JobTitle, StringComparison.Ordinal))
                continue;

            _lastSeen[record.UserId] = record.JobTitle;
            changed[record.UserId] = new UserJobTitleObservation(record.UserId, record.JobTitle, record.Timestamp);
        }
        return changed.Values.ToList();
    }

    /// <summary>Drops the memory for these users so their next request counts as a first sighting
    /// again — called when the write failed, so a transient DB error is retried rather than lost
    /// until the title next changes.</summary>
    public void Forget(IEnumerable<string> userIds)
    {
        foreach (var userId in userIds) _lastSeen.Remove(userId);
    }
}
