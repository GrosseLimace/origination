namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Per-user, per-feature daily rollup of usage activity. This is the rollup the Usage Dashboard's
/// feature panels read for historical days — unlike <see cref="FeatureUsageDaily"/> it carries a
/// user dimension, so trade-unit filtering and the excluded-users list can be honored without
/// rescanning the raw UserActivity/UserClickEvent tables.
/// <para>
/// Raw tables are pruned at 90 days; these rollups are kept far longer, so they are also the only
/// source of usage history beyond that window.
/// </para>
/// </summary>
public class UserFeatureUsageDaily
{
    public long Id { get; set; }
    public DateOnly ActivityDate { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string FeatureCode { get; set; } = string.Empty;

    /// <summary>Sentinel <c>__total__</c> holds the feature-level roll-up (and is the only row
    /// carrying <see cref="ScreenMinutes"/>); other values are specific sub-feature interactions.</summary>
    public string SubFeatureCode { get; set; } = "__total__";

    /// <summary>API requests attributed to this feature (from UserActivity).</summary>
    public int RequestCount { get; set; }

    /// <summary>Explicit "interaction" click events (from UserClickEvent).</summary>
    public int InteractionCount { get; set; }

    /// <summary>Time on screen, derived from the screen_enter sequence. Only set on __total__ rows.</summary>
    public double ScreenMinutes { get; set; }
}
