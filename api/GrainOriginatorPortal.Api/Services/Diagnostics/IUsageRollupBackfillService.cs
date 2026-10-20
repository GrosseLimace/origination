namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Rebuilds the usage-dashboard daily rollups from the raw UserActivity / UserClickEvent tables
/// (diagnostics route <c>usage-rollups/backfill</c>; admin-gated by the controller policy, available
/// in every environment).
/// </summary>
public interface IUsageRollupBackfillService
{
    /// <summary>
    /// Recomputes the daily rollups for the last <paramref name="days"/> days (clamped to 1..90, the
    /// raw-table retention window), then the weekly login rollups for every Monday-start week those
    /// days touch. The hourly aggregation job only ever processes the previous day, so this is how the
    /// rollups get populated for history that predates them.
    /// </summary>
    Task<UsageRollupBackfillResult> BackfillAsync(int days, CancellationToken cancellationToken);
}

public sealed record UsageRollupBackfillResult(int DaysAggregated, int WeeksAggregated);
