using System.Threading.Channels;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Infrastructure.Platform.Telemetry.Interfaces;

namespace GrainOriginatorPortal.Api.Platform.Telemetry;

/// <summary>
/// Background service that reads UserActivityRecord and UserClickEventRecord items from bounded channels
/// and batch-inserts them into the database. Also maintains session tracking:
/// a 30-minute gap between requests from the same user starts a new session.
/// </summary>
public class UsageTrackingBackgroundService : BackgroundService
{
    private readonly Channel<UserActivityRecord> _activityChannel;
    private readonly Channel<UserClickEventRecord> _clickChannel;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UsageTrackingBackgroundService> _logger;

    /// <summary>Per-user memory of the last job title seen, so only changes reach the DB. Owned by
    /// this loop alone, which is what lets it be a plain dictionary.</summary>
    private readonly JobTitleChangeTracker _jobTitles = new();

    private static readonly TimeSpan SessionGap = TimeSpan.FromMinutes(30);
    private const int BatchSize = 50;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(5);

    public UsageTrackingBackgroundService(
        Channel<UserActivityRecord> activityChannel,
        Channel<UserClickEventRecord> clickChannel,
        IServiceScopeFactory scopeFactory,
        ILogger<UsageTrackingBackgroundService> logger)
    {
        _activityChannel = activityChannel;
        _clickChannel = clickChannel;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Deliberately NO per-run correlation scope here, unlike the aggregation and customer-sync
        // services. Those are scheduled jobs where "show me just that run" is the first question
        // anyone asks; this loop flushes every 5 seconds (~17k runs a day) and logs almost nothing
        // outside errors, so a per-flush id would add Log Analytics cardinality without answering
        // a question anyone has. Individual failures already carry their batch context.
        _logger.LogInformation("UsageTrackingBackgroundService started");

        var activityBatch = new List<UserActivityRecord>(BatchSize);
        var clickBatch = new List<UserClickEventRecord>(BatchSize);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                activityBatch.Clear();
                clickBatch.Clear();

                // Wait for any item from either channel
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                cts.CancelAfter(FlushInterval);

                try
                {
                    // Drain activity channel
                    while (activityBatch.Count < BatchSize && _activityChannel.Reader.TryRead(out var record))
                        activityBatch.Add(record);

                    // Drain click channel
                    while (clickBatch.Count < BatchSize && _clickChannel.Reader.TryRead(out var click))
                        clickBatch.Add(click);

                    // If nothing yet, wait briefly
                    if (activityBatch.Count == 0 && clickBatch.Count == 0)
                    {
                        await _activityChannel.Reader.WaitToReadAsync(cts.Token);
                        while (activityBatch.Count < BatchSize && _activityChannel.Reader.TryRead(out var record))
                            activityBatch.Add(record);
                        while (clickBatch.Count < BatchSize && _clickChannel.Reader.TryRead(out var click))
                            clickBatch.Add(click);
                    }
                }
                catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
                {
                    // Flush interval elapsed
                }

                if (activityBatch.Count > 0 || clickBatch.Count > 0)
                    await FlushBatchAsync(activityBatch, clickBatch, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing usage tracking batch");
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }

        // Drain remaining on shutdown
        while (_activityChannel.Reader.TryRead(out var r)) activityBatch.Add(r);
        while (_clickChannel.Reader.TryRead(out var c)) clickBatch.Add(c);
        if (activityBatch.Count > 0 || clickBatch.Count > 0)
        {
            try { await FlushBatchAsync(activityBatch, clickBatch, CancellationToken.None); }
            catch (Exception ex) { _logger.LogError(ex, "Error flushing final usage tracking batch"); }
        }

        _logger.LogInformation("UsageTrackingBackgroundService stopped");
    }

    private async Task FlushBatchAsync(List<UserActivityRecord> activities, List<UserClickEventRecord> clicks, CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IUsageTelemetryRepository>();

        // Map incoming records to entities (feature codes derived here in the Api layer).
        var activityEntities = activities.Select(record =>
        {
            var (featureCode, subFeatureCode) = FeatureNameMapper.MapPathDetailed(record.HttpMethod, record.Path);
            return new UserActivity
            {
                UserId = record.UserId,
                HttpMethod = record.HttpMethod,
                Path = record.Path,
                StatusCode = record.StatusCode,
                DurationMs = record.DurationMs,
                FeatureCode = featureCode,
                SubFeatureCode = subFeatureCode,
                Timestamp = record.Timestamp
            };
        }).ToList();

        var clickEntities = clicks.Select(click => new UserClickEvent
        {
            UserId = click.UserId,
            EventType = click.EventType,
            FeatureCode = click.FeatureCode,
            SubFeatureCode = click.SubFeatureCode,
            TargetId = click.TargetId,
            Timestamp = click.Timestamp
        }).ToList();

        await repo.AddActivitiesAndClicksAsync(activityEntities, clickEntities, cancellationToken);

        // Update sessions from the activity rows.
        if (activityEntities.Count > 0)
            await repo.ApplyActivitySessionsAsync(activityEntities, SessionGap, cancellationToken);

        // Latest job title per user, from the token claim the middleware captured. Only first
        // sightings (since start-up) and changes reach the DB; the rest is a dictionary check.
        var titleObservations = _jobTitles.Observe(activities);
        if (titleObservations.Count == 0) return;
        try
        {
            await repo.UpsertUserJobTitlesAsync(titleObservations, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The activity rows above are already saved; a title write must never cost them. Forget
            // these users so the next batch retries instead of waiting for their title to change.
            _jobTitles.Forget(titleObservations.Select(o => o.UserId));
            _logger.LogWarning(ex,
                "Failed to record job titles for {UserCount} user(s); will retry on their next request",
                titleObservations.Count);
        }
    }
}
