// System namespaces
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// Defense in depth: AdminOnly caller claim + DenyIfNotDevelopment() per-route env gate.
// Both must pass — admin caller running in a non-Dev/QA environment still gets 404.
[Authorize(Policy = "AdminOnly")]
[Produces("application/json")]
public class DiagnosticsController : ControllerBase
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly TradeUnitPreferencesDbContext _tuPrefContext;
    private readonly ILogger<DiagnosticsController> _logger;
    private readonly IWebHostEnvironment _env;
    private readonly IHttpClientFactory _httpFactory;
    private readonly CustomerSyncService _customerSync;
    private readonly IGraphDirectoryClient _graphDirectory;
    private readonly IConfiguration _config;
    private static int _isGeocoding;

    public DiagnosticsController(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        TradeUnitPreferencesDbContext tuPrefContext,
        ILogger<DiagnosticsController> logger,
        IWebHostEnvironment env,
        IHttpClientFactory httpFactory,
        CustomerSyncService customerSync,
        IGraphDirectoryClient graphDirectory,
        IConfiguration config)
    {
        _context = context;
        _appContext = appContext;
        _tuPrefContext = tuPrefContext;
        _logger = logger;
        _env = env;
        _httpFactory = httpFactory;
        _customerSync = customerSync;
        _graphDirectory = graphDirectory;
        _config = config;
    }

    // -------------------------------------------------------------------------
    /// <summary>Tests connectivity to all three database contexts. Dev/QA only.</summary>
    [HttpGet("connections")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> CheckConnections()
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        static async Task<object> TestDb(DbContext db, string name, string testSql)
        {
            try
            {
                await db.Database.OpenConnectionAsync();
                var conn = db.Database.GetDbConnection();
                var dbName = conn.Database;
                string? result = null;
                using var cmd = conn.CreateCommand();
                cmd.CommandText = testSql;
                var raw = await cmd.ExecuteScalarAsync();
                result = raw?.ToString();
                return new { name, status = "OK", database = dbName, result };
            }
            catch (SqlException)
            {
                return new { name, status = "FAILED", message = "Database connection failed" };
            }
            catch (Exception)
            {
                return new { name, status = "FAILED", message = "Connection test failed" };
            }
        }

        // ODS tests must run sequentially — DbContext is not thread-safe
        var odsCustomers = await TestDb(_context, "ODS - vw_CurrentCustomers",
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA='originations' AND TABLE_NAME='vw_CurrentCustomers'");
        var odsPricing = await TestDb(_context, "ODS - vw_ContractPricing",
            "SELECT TOP 1 customer_id FROM originations.vw_ContractPricing");

        // Other contexts can run in parallel
        var otherResults = await Task.WhenAll(
            TestDb(_appContext, "Origination (OriginationConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProducerDetails'"),
            TestDb(_tuPrefContext, "TradeUnitPreferences (TradeUnitPreferencesConnection)",
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")
        );

        return Ok(new object[] { odsCustomers, odsPricing }.Concat(otherResults));
    }

    // -------------------------------------------------------------------------
    /// <summary>Returns 404 unless running in Development or QA.</summary>
    /// <remarks>
    /// These endpoints expose internal DB schema structure and must never be
    /// accessible in production. security-guide.md §4.3 (least privilege).
    /// </remarks>
    private IActionResult? DenyIfNotDevelopment()
        => _env.IsDevelopment() || _env.IsEnvironment("QA") ? null : NotFound();

    // -------------------------------------------------------------------------
    /// <summary>
    /// Validates that tableName is a safe SQL identifier (letters, digits, underscores only).
    /// Throws ValidationException if the name contains characters that could indicate injection.
    /// security-guide.md §4.1 input validation.
    /// </summary>
    private static void ValidateTableName(string tableName)
    {
        if (!Regex.IsMatch(tableName, @"^[A-Za-z_][A-Za-z0-9_]*$"))
            throw new ValidationException("tableName", "tableName must contain only letters, digits, and underscores.");
    }

    // -------------------------------------------------------------------------
    /// <summary>Lists all user tables in the connected database.</summary>
    [HttpGet("tables")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTables(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var result = await _context.Database.SqlQueryRaw<TableInfo>(
            @"SELECT DB_NAME() as DatabaseName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_TYPE = 'BASE TABLE'
              ORDER BY TABLE_NAME"
        ).ToListAsync(cancellationToken);

        var dbName = result.FirstOrDefault()?.DatabaseName ?? "Unknown";
        var tables = result.Select(t => t.TableName).ToList();

        return Ok(new { Database = dbName, TableCount = tables.Count, Tables = tables });
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets schema/table info for a specific table name.</summary>
    [HttpGet("tableschema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableWithSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;
        ValidateTableName(tableName);

        var result = await _context.Database.SqlQueryRaw<TableSchemaInfo>(
            @"SELECT TABLE_SCHEMA as SchemaName, TABLE_NAME as TableName
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_NAME = {0} AND TABLE_TYPE = 'BASE TABLE'",
            tableName
        ).ToListAsync(cancellationToken);

        return Ok(result);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets column definitions for a specific table.</summary>
    [HttpGet("schema/{tableName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTableSchema(string tableName, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;
        ValidateTableName(tableName);

        var columns = await _context.Database.SqlQueryRaw<ColumnInfo>(
            @"SELECT
                COLUMN_NAME as ColumnName,
                DATA_TYPE as DataType,
                IS_NULLABLE as IsNullable,
                CHARACTER_MAXIMUM_LENGTH as MaxLength,
                COLUMN_DEFAULT as DefaultValue
              FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_NAME = {0}
              ORDER BY ORDINAL_POSITION",
            tableName
        ).ToListAsync(cancellationToken);

        return Ok(new { TableName = tableName, ColumnCount = columns.Count, Columns = columns });
    }

    /// <summary>
    /// Manual on-demand trigger for the customer sync. Available in all
    /// environments to admins (gated by the controller-level
    /// <c>[Authorize(Policy = "AdminOnly")]</c>) — useful when prod needs an
    /// out-of-cycle refresh ahead of the next scheduled
    /// <see cref="CustomerSyncBackgroundService"/> run.
    ///
    /// Invokes the same upsert / soft-delete logic the scheduled service uses
    /// (see Services/CustomerSyncService). Replaces the legacy
    /// POST /api/diagnostics/customer-snapshot/populate endpoint that did a
    /// destructive DELETE+INSERT — the new sync preserves FK references from
    /// Notes / ProducerDetails / ProducerPlantingIntentions by soft-deleting.
    /// </summary>
    [HttpPost("customer-sync/run")]
    [ProducesResponseType(typeof(CustomerSyncResult), StatusCodes.Status200OK)]
    public async Task<IActionResult> RunCustomerSync(CancellationToken cancellationToken = default)
    {
        var result = await _customerSync.SyncAsync(cancellationToken);
        return Ok(result);
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Rebuilds the usage-dashboard daily rollups for the last <paramref name="days"/> days from the
    /// raw UserActivity / UserClickEvent tables. The hourly aggregation job only ever processes the
    /// previous day, so this is how the rollups get populated for history that predates them —
    /// run it once after deploying, otherwise the dashboard's historical charts read empty tables.
    /// Also useful after a feature-code mapping change, since aggregation is a full recompute.
    /// <para>Admin-gated by the controller policy; capped at the raw-table retention window since
    /// there is nothing older to aggregate from.</para>
    /// </summary>
    [HttpPost("usage-rollups/backfill")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> BackfillUsageRollups(
        [FromServices] IUsageRepository usageRepository,
        [FromQuery] int days = 90,
        CancellationToken cancellationToken = default)
    {
        days = Math.Clamp(days, 1, 90);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var weekStarts = new HashSet<DateOnly>();

        for (var offset = days; offset >= 1; offset--)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var date = today.AddDays(-offset);

            await usageRepository.AggregateUserActivityDailyAsync(date, cancellationToken);
            await usageRepository.AggregateFeatureUsageDailyAsync(date, cancellationToken);
            await usageRepository.AggregateUserFeatureUsageDailyAsync(date, cancellationToken);

            weekStarts.Add(date.AddDays(-(((int)date.DayOfWeek + 6) % 7))); // Monday-start
        }

        // Weekly rollups read UserActivityDaily, so they can only run once the days above exist.
        foreach (var weekStart in weekStarts.OrderBy(w => w))
            await usageRepository.AggregateWeeklyLoginsAsync(weekStart, cancellationToken);

        _logger.LogInformation("Backfilled usage rollups for {Days} days ({Weeks} weeks)", days, weekStarts.Count);
        return Ok(new { daysAggregated = days, weeksAggregated = weekStarts.Count });
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// App-access spike: reads the transitive member list of the Entra group configured at
    /// <c>AppAccess:GroupName</c> via Microsoft Graph, using the App Service managed identity
    /// (or the developer's own credential locally). Always 200 — the <c>Outcome</c> field is the
    /// verdict: Ok, or a categorized reason (EgressBlocked = NSG outbound rule needed,
    /// PermissionMissing = GroupMember.Read.All grant needed, TokenFailure, NotFound, NotConfigured).
    ///
    /// Deliberately NOT gated by <see cref="DenyIfNotDevelopment"/> (like customer-sync/run):
    /// the deployed dev environment runs ASPNETCORE_ENVIRONMENT=Dev, which that gate would 404 —
    /// and deployed Dev is exactly where the managed identity's Graph access must be proven.
    /// Read-only; admin-gated by the controller-level policy.
    /// </summary>
    [HttpGet("app-access-group-members")]
    [ProducesResponseType(typeof(AppAccessGroupMembersResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAppAccessGroupMembers(CancellationToken cancellationToken = default)
    {
        var groupId = _config.GetValue<string>("AppAccess:GroupId")?.Trim();
        var groupName = _config.GetValue<string>("AppAccess:GroupName")?.Trim();
        if (string.IsNullOrEmpty(groupId) && string.IsNullOrEmpty(groupName))
        {
            return Ok(new AppAccessGroupMembersResponse
            {
                GroupName = string.Empty,
                Outcome = "NotConfigured",
                Detail = "Neither AppAccess:GroupId nor AppAccess:GroupName is set for this environment."
            });
        }

        // Prefer the direct object read — the scoped managed identity can read its specific
        // group(s) but cannot list/search, so the name-search path only works locally.
        var groupResult = !string.IsNullOrEmpty(groupId)
            ? await _graphDirectory.GetGroupByIdAsync(groupId, cancellationToken)
            : await _graphDirectory.FindGroupByNameAsync(groupName!, cancellationToken);
        var label = groupResult.Value?.DisplayName ?? groupName ?? groupId!;
        if (!groupResult.Ok)
        {
            return Ok(new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = groupResult.Status.ToString(),
                HttpStatus = groupResult.HttpStatus,
                Detail = groupResult.Detail
            });
        }

        var membersResult = await _graphDirectory.GetGroupTransitiveUserMembersAsync(groupResult.Value!.Id, cancellationToken);
        if (!membersResult.Ok)
        {
            return Ok(new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = membersResult.Status.ToString(),
                HttpStatus = membersResult.HttpStatus,
                Detail = membersResult.Detail
            });
        }

        var members = membersResult.Value!
            .OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(u => new AppAccessGroupMemberResponse
            {
                DisplayName = u.DisplayName,
                UserPrincipalName = u.UserPrincipalName,
                AccountEnabled = u.AccountEnabled
            })
            .ToList();

        // Group-scoped grant without User.ReadBasic.All: Graph returns members but strips user
        // properties. Call that out as its own outcome — it's the last step of the grant progression.
        var idOnlyCount = members.Count(m => string.IsNullOrEmpty(m.UserPrincipalName));
        if (members.Count > 0 && idOnlyCount == members.Count)
        {
            return Ok(new AppAccessGroupMembersResponse
            {
                GroupName = label,
                Outcome = "MembersIdOnly",
                HttpStatus = 200,
                Detail = $"{members.Count} members returned, but with ids only (no names/UPNs) — the identity " +
                         "also needs the User.ReadBasic.All application permission. The app matches people by " +
                         "UPN, so filtering stays OFF (fail-open) until that grant lands.",
                MemberCount = members.Count,
                Members = members
            });
        }

        _logger.LogInformation("App-access group read OK: {MemberCount} members", members.Count);
        return Ok(new AppAccessGroupMembersResponse
        {
            GroupName = label,
            Outcome = "Ok",
            HttpStatus = 200,
            Detail = idOnlyCount > 0
                ? $"{idOnlyCount} of {members.Count} members returned id-only (no UPN) and are excluded from matching."
                : null,
            MemberCount = members.Count,
            Members = members
        });
    }

    // -------------------------------------------------------------------------
    private record TableInfo
    {
        public string DatabaseName { get; init; } = "";
        public string TableName { get; init; } = "";
    }

    private record TableSchemaInfo
    {
        public string SchemaName { get; init; } = "";
        public string TableName { get; init; } = "";
    }

    /// <summary>
    /// Seeds dbo.Commodities from distinct CommodityCode/CommodityDescription in ODS contracts.
    /// Skips codes that already exist. Dev/QA only.
    /// </summary>
    [HttpPost("commodities/seed")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> SeedCommodities(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        // Get distinct commodity codes from ODS contracts
        var odsContracts = await _context.Contracts.AsNoTracking()
            .Where(c => c.ContractPrefixType == "P" && c.CommodityCode != null && c.CommodityCode != ""
                     && c.CommodityDescription != null && c.CommodityDescription != "")
            .Select(c => new { c.CommodityCode, c.CommodityDescription })
            .Distinct()
            .ToListAsync(cancellationToken);

        // Get existing commodity codes
        var existingCodes = await _appContext.Commodities
            .Select(c => c.Code)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<string>(existingCodes, StringComparer.OrdinalIgnoreCase);

        int inserted = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in odsContracts)
        {
            var code = item.CommodityCode!.Trim();
            if (existingSet.Contains(code) || seen.Contains(code)) continue;
            seen.Add(code);

            _appContext.Commodities.Add(new Commodity
            {
                Code = code,
                Name = item.CommodityDescription!.Trim(),
                IsActive = true
            });
            inserted++;
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        return Ok(new { Inserted = inserted, AlreadyExisted = existingCodes.Count, TotalOds = odsContracts.Count });
    }

    /// <summary>
    /// Copies all elevators from ODS ctrm.vw_GNP026 into dbo.ElevatorCache.
    /// Upserts by ElevatorCode — existing rows are updated, new rows are inserted.
    /// Optionally geocodes elevators missing coordinates (pass ?geocode=true, slow ~1 req/sec).
    /// Dev/QA only.
    /// </summary>
    [HttpPost("elevator-cache/refresh")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> RefreshElevatorCache([FromQuery] bool geocode = false, CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var sw = System.Diagnostics.Stopwatch.StartNew();

        // Read all elevators from ODS
        var odsElevators = await _context.Elevators.AsNoTracking().ToListAsync(cancellationToken);

        // Read existing cache
        var existingCache = await _appContext.ElevatorCaches.ToDictionaryAsync(e => e.ElevatorCode, cancellationToken);

        int inserted = 0, updated = 0, geocoded = 0, geoFailed = 0;

        foreach (var elev in odsElevators)
        {
            var code = (elev.ElevatorCode ?? "").Trim();
            if (string.IsNullOrEmpty(code)) continue;

            if (existingCache.TryGetValue(code, out var cached))
            {
                // Update existing
                cached.ElevatorShortName = elev.ElevatorShortName?.Trim();
                cached.ElevatorName = elev.ElevatorName?.Trim();
                cached.Address = elev.Address1?.Trim();
                cached.City = elev.City?.Trim();
                cached.State = elev.State?.Trim();
                cached.ZipCode = elev.ZipCode?.ToString("0");
                cached.OurFacility = elev.OurFacility?.Trim();
                cached.TradeUnitCode = elev.ElevatorLocationCode?.Trim();
                cached.LastRefreshedAt = DateTime.UtcNow;
                updated++;
            }
            else
            {
                // Insert new
                var newEntry = new ElevatorCache
                {
                    ElevatorCode = code,
                    ElevatorShortName = elev.ElevatorShortName?.Trim(),
                    ElevatorName = elev.ElevatorName?.Trim(),
                    Address = elev.Address1?.Trim(),
                    City = elev.City?.Trim(),
                    State = elev.State?.Trim(),
                    ZipCode = elev.ZipCode?.ToString("0"),
                    OurFacility = elev.OurFacility?.Trim(),
                    TradeUnitCode = elev.ElevatorLocationCode?.Trim(),
                    IsActive = true,
                    LastRefreshedAt = DateTime.UtcNow
                };
                _appContext.ElevatorCaches.Add(newEntry);
                existingCache[code] = newEntry;
                inserted++;
            }
        }

        await _appContext.SaveChangesAsync(cancellationToken);

        // Optional geocoding for entries missing coordinates
        if (geocode)
        {
            var toGeocode = await _appContext.ElevatorCaches
                .Where(e => e.Latitude == null && e.IsActive)
                .Where(e => e.City != null || e.Address != null)
                .ToListAsync(cancellationToken);

            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("GrainOriginatorPortal/1.0");

            foreach (var elev in toGeocode)
            {
                if (cancellationToken.IsCancellationRequested) break;

                var parts = new[] { elev.Address?.Trim(), elev.City?.Trim(), elev.State?.Trim() }
                    .Where(p => !string.IsNullOrWhiteSpace(p));
                var query = string.Join(", ", parts);
                if (string.IsNullOrWhiteSpace(query)) { geoFailed++; continue; }

                try
                {
                    await Task.Delay(1100, cancellationToken);
                    var url = $"https://nominatim.openstreetmap.org/search?format=json&limit=1&q={Uri.EscapeDataString(query)}";
                    var response = await client.GetAsync(url, cancellationToken);

                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync(cancellationToken);
                        var results = JsonSerializer.Deserialize<JsonElement[]>(json);
                        if (results != null && results.Length > 0)
                        {
                            elev.Latitude = double.Parse(results[0].GetProperty("lat").GetString()!);
                            elev.Longitude = double.Parse(results[0].GetProperty("lon").GetString()!);
                            geocoded++;
                        }
                        else { geoFailed++; }
                    }
                    else { geoFailed++; }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Geocoding failed for {Code}", elev.ElevatorCode);
                    geoFailed++;
                }
            }

            await _appContext.SaveChangesAsync(cancellationToken);
        }

        sw.Stop();
        return Ok(new
        {
            OdsTotal = odsElevators.Count,
            Inserted = inserted,
            Updated = updated,
            Geocoded = geocoded,
            GeoFailed = geoFailed,
            ElapsedSeconds = sw.Elapsed.TotalSeconds
        });
    }

    /// <summary>
    /// Starts geocoding all elevators missing coordinates in the background.
    /// Returns immediately with estimated time. Check progress via GET elevator-cache/geocode-status.
    /// </summary>
    [HttpPost("elevator-cache/geocode")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    public IActionResult StartElevatorGeocode(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        if (Interlocked.CompareExchange(ref _isGeocoding, 1, 0) != 0)
            return Conflict(new { Message = "Geocoding is already in progress." });

        var missing = _appContext.ElevatorCaches
            .Count(e => e.Latitude == null && e.IsActive && (e.City != null || e.Address != null));

        // Capture the service provider before the request ends
        var serviceProvider = HttpContext.RequestServices.GetRequiredService<IServiceScopeFactory>();
        _ = Task.Run(async () =>
        {
            try { await GeocodeElevatorsBackground(serviceProvider); }
            finally { Interlocked.Exchange(ref _isGeocoding, 0); }
        });

        return Accepted(new
        {
            Message = "Geocoding started in background",
            ElevatorsToGeocode = missing,
            EstimatedMinutes = Math.Ceiling(missing * 1.1 / 60.0)
        });
    }

    /// <summary>Returns current geocoding progress.</summary>
    [HttpGet("elevator-cache/geocode-status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetGeocodeStatus(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var total = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive, cancellationToken);
        var withCoords = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive && e.Latitude != null, cancellationToken);
        var missing = total - withCoords;

        return Ok(new
        {
            Total = total,
            WithCoordinates = withCoords,
            MissingCoordinates = missing,
            PercentComplete = total > 0 ? Math.Round(100.0 * withCoords / total, 1) : 0
        });
    }

    private async Task GeocodeElevatorsBackground(IServiceScopeFactory scopeFactory)
    {
        try
        {
            // Create a new scope since the controller's DbContext will be disposed
            using var scope = scopeFactory.CreateScope();
            var appContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var httpFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
            var logger = scope.ServiceProvider.GetRequiredService<ILogger<DiagnosticsController>>();

            var toGeocode = await appContext.ElevatorCaches
                .Where(e => e.Latitude == null && e.IsActive)
                .Where(e => e.City != null || e.Address != null)
                .ToListAsync();

            var client = httpFactory.CreateClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("GrainOriginatorPortal/1.0");

            int done = 0, failed = 0;

            foreach (var elev in toGeocode)
            {
                var parts = new[] { elev.Address?.Trim(), elev.City?.Trim(), elev.State?.Trim() }
                    .Where(p => !string.IsNullOrWhiteSpace(p));
                var query = string.Join(", ", parts);
                if (string.IsNullOrWhiteSpace(query)) { failed++; continue; }

                try
                {
                    await Task.Delay(1100);
                    var url = $"https://nominatim.openstreetmap.org/search?format=json&limit=1&q={Uri.EscapeDataString(query)}";
                    var response = await client.GetAsync(url);

                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        var results = JsonSerializer.Deserialize<JsonElement[]>(json);
                        if (results != null && results.Length > 0)
                        {
                            elev.Latitude = double.Parse(results[0].GetProperty("lat").GetString()!);
                            elev.Longitude = double.Parse(results[0].GetProperty("lon").GetString()!);
                            done++;
                        }
                        else { failed++; }
                    }
                    else { failed++; }

                    // Save every 50 to avoid losing progress
                    if ((done + failed) % 50 == 0)
                        await appContext.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Geocoding failed for {Code}", elev.ElevatorCode);
                    failed++;
                }
            }

            await appContext.SaveChangesAsync();
            logger.LogInformation("Elevator geocoding complete: {Done} geocoded, {Failed} failed", done, failed);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Background elevator geocoding crashed");
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Geocode missing elevators using zip code centroids (zippopotam.us).</summary>
    [HttpPost("elevator-cache/geocode-zip")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GeocodeByZip(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var missing = await _appContext.ElevatorCaches
            .Where(e => e.Latitude == null && e.IsActive && e.ZipCode != null && e.ZipCode != "0")
            .ToListAsync(cancellationToken);

        if (missing.Count == 0)
            return Ok(new { Message = "No elevators need zip-based geocoding", Updated = 0 });

        // Group by zip to avoid redundant API calls
        var byZip = missing.GroupBy(e => e.ZipCode!.Trim().Split('.')[0].Split('-')[0]).ToList();
        var client = _httpFactory.CreateClient();
        int updated = 0, failed = 0;
        var zipCache = new Dictionary<string, (double lat, double lng)>();

        foreach (var group in byZip)
        {
            var zip = group.Key;
            if (string.IsNullOrWhiteSpace(zip) || zip == "0") { failed += group.Count(); continue; }

            // Normalize: take first 5 digits
            if (zip.Length > 5) zip = zip[..5];

            if (!zipCache.TryGetValue(zip, out var coords))
            {
                try
                {
                    await Task.Delay(100, cancellationToken); // Be polite
                    var response = await client.GetAsync($"https://api.zippopotam.us/us/{zip}", cancellationToken);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync(cancellationToken);
                        var doc = JsonSerializer.Deserialize<JsonElement>(json);
                        var places = doc.GetProperty("places");
                        if (places.GetArrayLength() > 0)
                        {
                            var place = places[0];
                            var lat = double.Parse(place.GetProperty("latitude").GetString()!);
                            var lng = double.Parse(place.GetProperty("longitude").GetString()!);
                            coords = (lat, lng);
                            zipCache[zip] = coords;
                        }
                        else { failed += group.Count(); continue; }
                    }
                    else { failed += group.Count(); continue; }
                }
                catch { failed += group.Count(); continue; }
            }

            foreach (var elev in group)
            {
                elev.Latitude = coords.lat;
                elev.Longitude = coords.lng;
                updated++;
            }

            // Save every 100
            if (updated % 100 == 0) await _appContext.SaveChangesAsync(cancellationToken);
        }

        await _appContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            Message = "Zip-based geocoding complete",
            UniqueZips = byZip.Count,
            Updated = updated,
            Failed = failed
        });
    }

    private record ColumnInfo
    {
        public string ColumnName { get; init; } = "";
        public string DataType { get; init; } = "";
        public string IsNullable { get; init; } = "";
        public int? MaxLength { get; init; }
        public string? DefaultValue { get; init; }
    }
}
