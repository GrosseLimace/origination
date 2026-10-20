// Project namespaces
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer).
/// </summary>
public sealed class UsageRollupBackfillService : IUsageRollupBackfillService
{
    private readonly IUsageRepository _usageRepository;
    private readonly ILogger<UsageRollupBackfillService> _logger;

    public UsageRollupBackfillService(IUsageRepository usageRepository, ILogger<UsageRollupBackfillService> logger)
    {
        _usageRepository = usageRepository;
        _logger = logger;
    }

    public async Task<UsageRollupBackfillResult> BackfillAsync(int days, CancellationToken cancellationToken)
    {
        days = Math.Clamp(days, 1, 90);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var weekStarts = new HashSet<DateOnly>();

        for (var offset = days; offset >= 1; offset--)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var date = today.AddDays(-offset);

            await _usageRepository.AggregateUserActivityDailyAsync(date, cancellationToken);
            await _usageRepository.AggregateFeatureUsageDailyAsync(date, cancellationToken);
            await _usageRepository.AggregateUserFeatureUsageDailyAsync(date, cancellationToken);

            weekStarts.Add(date.AddDays(-(((int)date.DayOfWeek + 6) % 7))); // Monday-start
        }

        // Weekly rollups read UserActivityDaily, so they can only run once the days above exist.
        foreach (var weekStart in weekStarts.OrderBy(w => w))
            await _usageRepository.AggregateWeeklyLoginsAsync(weekStart, cancellationToken);

        _logger.LogInformation("Backfilled usage rollups for {Days} days ({Weeks} weeks)", days, weekStarts.Count);
        return new UsageRollupBackfillResult(days, weekStarts.Count);
    }
}
