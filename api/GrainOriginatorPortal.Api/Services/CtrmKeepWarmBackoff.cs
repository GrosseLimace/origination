namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Remembers which producer sets the keep-warm cycle should leave alone for a while, after one of their
/// reads failed.
/// </summary>
/// <remarks>
/// <para>Without this the cycle re-ran a failing walk every five minutes for every set in use - 59 batched
/// contract requests plus their retries, then the ticket walk, then Spot Loads - while the gateway was
/// already too slow to answer any of them, and while every timed-out query kept running on the database
/// (the API team measured 70 s and more). Four copies of the app doing that at once against the nonprod
/// database on 2026-09-28 turned a slow phase into an evening of 503s.</para>
///
/// <para>A set that failed is skipped until its back-off expires. The caches keep their last good copy
/// meanwhile, and a user's own request still goes through: this gates only the background cycle.</para>
/// </remarks>
internal sealed class CtrmKeepWarmBackoff
{
    private readonly Dictionary<string, DateTime> _until = new(StringComparer.Ordinal);

    /// <summary>One key per producer set, whatever order the codes arrive in.</summary>
    public static string KeyFor(IReadOnlyList<string> codes) =>
        string.Join("|", codes.Select(c => c.Trim()).Where(c => c.Length > 0).OrderBy(c => c, StringComparer.Ordinal));

    /// <summary>Leave this set alone until <paramref name="nowUtc"/> + <paramref name="duration"/>.</summary>
    public void Record(IReadOnlyList<string> codes, DateTime nowUtc, TimeSpan duration)
    {
        lock (_until) _until[KeyFor(codes)] = nowUtc + duration;
    }

    /// <summary>True while the set's back-off has not yet expired. An expired entry is forgotten.</summary>
    public bool IsBackedOff(IReadOnlyList<string> codes, DateTime nowUtc)
    {
        var key = KeyFor(codes);
        lock (_until)
        {
            if (!_until.TryGetValue(key, out var until)) return false;
            if (nowUtc < until) return true;
            _until.Remove(key);
            return false;
        }
    }

    /// <summary>A successful cycle clears the set's back-off, so one bad phase does not linger.</summary>
    public void Clear(IReadOnlyList<string> codes)
    {
        lock (_until) _until.Remove(KeyFor(codes));
    }
}
