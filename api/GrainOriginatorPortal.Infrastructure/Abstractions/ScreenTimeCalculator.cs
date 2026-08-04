namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Derives "time spent on screen" from a user's sequence of screen_enter events.
/// <para>
/// There is no screen_exit event, so time on screen N is inferred as (enter N+1 − enter N). Gaps
/// longer than <see cref="MaxGapMinutes"/> mean the user walked away rather than navigated, so they
/// are discarded instead of counted. The final event in a sequence has no successor to measure
/// against and is credited <see cref="TrailingMinutes"/> minute — which means a visit of any length
/// that involves no further navigation registers as one minute, a known floor of this approach.
/// </para>
/// Shared by the live dashboard queries and the daily rollup job so both report the same numbers.
/// </summary>
public static class ScreenTimeCalculator
{
    public const double MaxGapMinutes = 30;
    public const double TrailingMinutes = 1;

    /// <summary>
    /// Accumulates minutes per feature code across all users in <paramref name="events"/>.
    /// Events may arrive in any order; they are grouped per user and sorted internally.
    /// </summary>
    public static Dictionary<string, double> MinutesByFeature(IEnumerable<ScreenEnterEvent> events)
    {
        var totals = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var (_, featureCode, minutes) in PerUserFeatureMinutes(events))
            totals[featureCode] = totals.GetValueOrDefault(featureCode) + minutes;
        return totals;
    }

    /// <summary>
    /// Accumulates minutes per (user, feature) pair — the shape the per-user daily rollup needs.
    /// </summary>
    public static Dictionary<(string UserId, string FeatureCode), double> MinutesByUserAndFeature(
        IEnumerable<ScreenEnterEvent> events)
    {
        var totals = new Dictionary<(string, string), double>();
        foreach (var (userId, featureCode, minutes) in PerUserFeatureMinutes(events))
        {
            var key = (userId, featureCode);
            totals[key] = totals.GetValueOrDefault(key) + minutes;
        }
        return totals;
    }

    /// <summary>
    /// Accumulates minutes per (calendar day, feature) for a single user's event sequence — the
    /// shape the per-user drill-down's daily series needs. Days are the UTC date of the event.
    /// </summary>
    public static Dictionary<(DateTime Date, string FeatureCode), double> MinutesByDayAndFeature(
        IEnumerable<ScreenEnterEvent> events)
    {
        var totals = new Dictionary<(DateTime, string), double>();
        foreach (var userGroup in GroupByUser(events))
        {
            var ordered = userGroup.ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                var minutes = MinutesForEventAt(ordered, i);
                if (minutes <= 0) continue;
                var key = (ordered[i].Timestamp.Date, ordered[i].FeatureCode);
                totals[key] = totals.GetValueOrDefault(key) + minutes;
            }
        }
        return totals;
    }

    private static IEnumerable<(string UserId, string FeatureCode, double Minutes)> PerUserFeatureMinutes(
        IEnumerable<ScreenEnterEvent> events)
    {
        foreach (var userGroup in GroupByUser(events))
        {
            var ordered = userGroup.ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                var minutes = MinutesForEventAt(ordered, i);
                if (minutes > 0)
                    yield return (ordered[i].UserId, ordered[i].FeatureCode, minutes);
            }
        }
    }

    private static IEnumerable<IEnumerable<ScreenEnterEvent>> GroupByUser(IEnumerable<ScreenEnterEvent> events) =>
        events
            .GroupBy(e => e.UserId, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderBy(e => e.Timestamp));

    private static double MinutesForEventAt(List<ScreenEnterEvent> ordered, int index)
    {
        // The last event has no successor to measure against.
        if (index == ordered.Count - 1)
            return TrailingMinutes;

        var gap = (ordered[index + 1].Timestamp - ordered[index].Timestamp).TotalMinutes;
        return gap > 0 && gap <= MaxGapMinutes ? gap : 0;
    }
}
