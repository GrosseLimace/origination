using System.Text.RegularExpressions;
using System.Threading.Channels;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

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
        var repo = scope.ServiceProvider.GetRequiredService<IUsageRepository>();

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
    }
}

/// <summary>
/// Maps API paths + HTTP methods to feature codes and sub-feature codes.
/// </summary>
public static class FeatureNameMapper
{
    private static readonly Regex CustomerIdPattern = new(@"^/api/customers/\d+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Returns (featureCode, subFeatureCode) for a given HTTP method + path.
    /// </summary>
    public static (string FeatureCode, string? SubFeatureCode) MapPathDetailed(string method, string path)
    {
        var p = path.ToLowerInvariant();
        var m = method.ToUpperInvariant();

        // Customer Page features
        // Customer Details = viewing a specific customer (GET /api/customers/{id})
        if (CustomerIdPattern.IsMatch(p))
            return ("customers", "customer-details");
        // Customer List = loading customer list from dropdown (GET /api/customers)
        if (p.StartsWith("/api/customers"))
            return ("customers", "customer-list");
        // Notes Create = creating a note (POST /api/notes only, GET/PUT excluded)
        if (p.StartsWith("/api/notes") && m == "POST")
            return ("customers", "notes-create");
        if (p.StartsWith("/api/notes"))
            return ("customers", null); // other notes operations don't count as a tracked sub-feature
        // Contracts = selecting/expanding a contract (GET /api/contracts with id or pricing lines)
        if (p.StartsWith("/api/contractpricinglines"))
            return ("customers", "contracts");
        if (p.StartsWith("/api/contracts"))
            return ("customers", "contracts");
        // Tickets = clicking the Tickets tab (GET /api/tickets)
        if (p.StartsWith("/api/tickets") || p.StartsWith("/api/ticketquality"))
            return ("customers", "tickets");
        // Planting Intentions = clicking the Planting tab (GET/POST /api/plantingintentions)
        if (p.StartsWith("/api/plantingintentions"))
            return ("customers", "planting-intentions");
        // Storage = clicking the Storage tab (GET /api/storedgrain)
        if (p.StartsWith("/api/storedgrain"))
            return ("customers", "storage");
        // DP Contracts = clicking the DP Contracts tab (GET /api/dpcontracts)
        if (p.StartsWith("/api/dpcontracts"))
            return ("customers", "dp-contracts");
        // Producer Details = clicking edit on producer details (GET/PUT /api/producerdetails)
        if (p.StartsWith("/api/producerdetails"))
            return ("customers", "producer-details");

        // Planting Intention Dashboard
        // Set Season Targets = editing yield estimates or market shares (PUT/DELETE)
        if (p.StartsWith("/api/dashboardplantingestimates") && m is "PUT" or "DELETE")
            return ("dashboard", "set-season-targets");
        if (p.StartsWith("/api/dashboardmarketshares") && m is "PUT" or "DELETE")
            return ("dashboard", "set-season-targets");
        // By Crop = viewing planting estimates (auto-loads on dashboard open)
        if (p.StartsWith("/api/dashboardplantingestimates"))
            return ("dashboard", "by-crop");
        // Top Producers = clicking the Top Producers tab
        if (p.StartsWith("/api/dashboardmarketshares"))
            return ("dashboard", "top-producers");
        // Harvest & Contracts = clicking the Harvest & Contracts tab
        if (p.StartsWith("/api/dashboardactualharvests"))
            return ("dashboard", "harvest-contracts");

        // Build a List
        if (p.StartsWith("/api/savedlists"))
            return ("build-a-list", m == "POST" ? "save-list" : "manage-members");

        // Bid Sheet
        if (p.Contains("/bidsheet/locations"))
            return ("bidsheet", m == "POST" ? "add-locations" : "bid-sheet-panel");
        if (p.Contains("/bidsheet/bids") || p.Contains("/bidsheet/location-bids"))
            return ("bidsheet", m == "PUT" ? "edit-bids" : "bid-sheet-panel");
        if (p.Contains("/bidsheet/references"))
            return ("bidsheet", "references-set");
        if (p.Contains("/bidsheet/location-order"))
            return ("bidsheet", "bid-sheet-panel");
        if (p.StartsWith("/api/bidsheet"))
            return ("bidsheet", "bid-sheet-panel");

        // Actionable Insights (these are typically GET requests to existing endpoints filtered)
        if (p.StartsWith("/api/unshippedbushels"))
            return ("insights", "unshipped-bushels");

        // Usage Dashboard itself
        if (p.StartsWith("/api/usage-dashboard"))
            return ("usage-dashboard", null);

        // Supporting features (not primary screens)
        if (p.StartsWith("/api/commodities"))
            return ("system", "commodities");
        if (p.StartsWith("/api/tradeunits"))
            return ("system", "trade-units");
        if (p.StartsWith("/api/elevators"))
            return ("system", "elevators");
        if (p.StartsWith("/api/userpreferences"))
            return ("system", "user-preferences");
        if (p.StartsWith("/api/esignenrollment"))
            return ("system", "esign");
        if (p.StartsWith("/api/harvestwindows"))
            return ("system", "harvest-windows");
        if (p.StartsWith("/api/commodityconversions"))
            return ("system", "commodity-conversions");

        return ("other", null);
    }

    /// <summary>
    /// Simple path-to-display-name mapping for backward compatibility.
    /// </summary>
    public static string MapPath(string path)
    {
        var (featureCode, _) = MapPathDetailed("GET", path);
        return featureCode switch
        {
            "customers" => "Customers",
            "dashboard" => "Dashboard",
            "build-a-list" => "Build a List",
            "bidsheet" => "Bid Sheet",
            "insights" => "Actionable Insights",
            "usage-dashboard" => "Usage Dashboard",
            "system" => "System",
            _ => "Other"
        };
    }
}
