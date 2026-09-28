using System.Collections.Concurrent;
using System.Globalization;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Remembers which producer sets the trade-unit-wide reads have served recently, so a background
/// service can keep their caches warm.
/// </summary>
/// <remarks>
/// <para>The trade-unit caches are only filled when a user's home page loads. Left alone they expire on
/// their TTLs, and the next prompt after a quiet spell pays the full walk again (contracts: hundreds of
/// per-producer calls; tickets: a 100+ page, minutes-long walk for a large trade unit). This registry is
/// the list of sets worth keeping warm: every trade-unit-wide read touches it, and
/// <c>CtrmKeepWarmService</c> re-runs the reads for recently-touched sets on a cadence so their
/// stale-while-revalidate refreshes happen on the clock instead of on a user's prompt.</para>
///
/// <para>Deliberately in-memory: after a restart the registry is empty until home pages load again, so
/// the first load per set per process still pays cold. Persisting the sets was considered and skipped -
/// the codes come from the Origination DB per trade unit and can drift, so replaying a stale set would
/// warm the wrong producers.</para>
///
/// <para>Capped so an unbounded variety of selections cannot grow it forever; when full, the least
/// recently touched set is evicted. Thread-safe; the code lists are immutable snapshots.</para>
/// </remarks>
public sealed class CtrmWarmRegistry
{
    private const int MaxTrackedSets = 32;

    private readonly ConcurrentDictionary<string, Entry> _sets = new(StringComparer.Ordinal);

    private sealed record Entry(IReadOnlyList<string> Codes, DateTime LastTouchedUtc);

    /// <summary>Records that a trade-unit-wide read just served this producer set.</summary>
    public void Touch(IReadOnlyCollection<string> codes, DateTime utcNow)
    {
        if (codes.Count == 0) return;

        var snapshot = codes
            .Select(c => c?.Trim())
            .Where(c => !string.IsNullOrEmpty(c))
            .Select(c => c!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (snapshot.Count == 0) return;

        _sets[Key(snapshot)] = new Entry(snapshot, utcNow);

        // Evict least-recently-touched sets past the cap. Racy by design: an eviction losing to a
        // concurrent Touch simply keeps one extra set until the next call.
        while (_sets.Count > MaxTrackedSets)
        {
            var oldest = _sets.MinBy(p => p.Value.LastTouchedUtc);
            _sets.TryRemove(oldest.Key, out _);
        }
    }

    /// <summary>The producer sets touched within the given window, most recent first.</summary>
    public IReadOnlyList<IReadOnlyList<string>> ActiveSets(TimeSpan touchedWithin, DateTime utcNow)
        => [.. _sets.Values
            .Where(e => utcNow - e.LastTouchedUtc <= touchedWithin)
            .OrderByDescending(e => e.LastTouchedUtc)
            .Select(e => e.Codes)];

    /// <summary>How many sets are currently tracked - for diagnostics and tests.</summary>
    public int Count => _sets.Count;

    /// <summary>Order-independent key for a normalized (sorted, de-duplicated) code set. FNV-1a, the
    /// same shape the readers use for their producer-set cache keys.</summary>
    private static string Key(IReadOnlyList<string> sortedCodes)
    {
        var hash = 2166136261u;
        foreach (var code in sortedCodes)
        {
            foreach (var c in code.ToUpperInvariant())
            {
                hash ^= c;
                hash *= 16777619u;
            }
            hash ^= (byte)',';
            hash *= 16777619u;
        }
        return sortedCodes.Count.ToString(CultureInfo.InvariantCulture) + ":" + hash.ToString("x8", CultureInfo.InvariantCulture);
    }
}
