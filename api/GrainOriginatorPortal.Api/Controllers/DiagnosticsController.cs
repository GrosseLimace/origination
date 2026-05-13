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
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;

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
    private readonly EntitlementsDbContext _entContext;
    private readonly ILogger<DiagnosticsController> _logger;
    private readonly IWebHostEnvironment _env;
    private readonly IHttpClientFactory _httpFactory;
    private static int _isGeocoding;

    public DiagnosticsController(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        EntitlementsDbContext entContext,
        ILogger<DiagnosticsController> logger,
        IWebHostEnvironment env,
        IHttpClientFactory httpFactory)
    {
        _context = context;
        _appContext = appContext;
        _entContext = entContext;
        _logger = logger;
        _env = env;
        _httpFactory = httpFactory;
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
            TestDb(_entContext, "Entitlements (EntitlementsConnection)",
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
    /// Populates dbo.Customer and dbo.CustomerTradeUnit in the Origination DB from
    /// originations.vw_CustomerTradeUnits in ODS. One-time / on-demand operation — dev only.
    ///
    /// This endpoint is a placeholder for the proper scheduled sync service (Phase 6 of
    /// database-design-issues.md). The route keeps its legacy "customer-snapshot/populate"
    /// path to avoid breaking any out-of-band tooling that calls it.
    /// </summary>
    [HttpPost("customer-snapshot/populate")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> PopulateCustomerSnapshot(CancellationToken cancellationToken = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var sw = System.Diagnostics.Stopwatch.StartNew();

        // Read all customer-trade unit rows from ODS view
        var customerTradeUnits = await _context.CustomerTradeUnits
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        // Clear existing rows in FK order — CustomerTradeUnit FKs Customer, so child first.
        // Notes / ProducerDetails / ProducerPlantingIntentions also FK to Customer, so we
        // disable those constraints during the DELETE+INSERT to avoid wiping the user-
        // authored rows. After the rebuild completes, every original Customer row is
        // re-created, so the FKs are valid again. Re-enable WITH CHECK to catch any drift.
        const string disableFks = @"
            ALTER TABLE [dbo].[Notes] NOCHECK CONSTRAINT FK_Notes_Customer_CustomerId;
            ALTER TABLE [dbo].[ProducerDetails] NOCHECK CONSTRAINT FK_ProducerDetails_Customer_CustomerId;
            ALTER TABLE [dbo].[ProducerPlantingIntentions] NOCHECK CONSTRAINT FK_ProducerPlantingIntentions_Customer_CustomerId;";
        const string enableFks = @"
            ALTER TABLE [dbo].[Notes] WITH CHECK CHECK CONSTRAINT FK_Notes_Customer_CustomerId;
            ALTER TABLE [dbo].[ProducerDetails] WITH CHECK CHECK CONSTRAINT FK_ProducerDetails_Customer_CustomerId;
            ALTER TABLE [dbo].[ProducerPlantingIntentions] WITH CHECK CHECK CONSTRAINT FK_ProducerPlantingIntentions_Customer_CustomerId;";

        await _appContext.Database.ExecuteSqlRawAsync(disableFks, cancellationToken);
        await _appContext.Database.ExecuteSqlRawAsync("DELETE FROM dbo.CustomerTradeUnit", cancellationToken);
        await _appContext.Database.ExecuteSqlRawAsync("DELETE FROM dbo.Customer", cancellationToken);

        // -------------------------------------------------------------------------
        // Customer — one row per distinct CustomerId. Attributes are identical across
        // the multiple ODS view rows for the same customer (they all come from the
        // same source customer record), so picking the first row by group is safe.
        // -------------------------------------------------------------------------
        var customerRows = customerTradeUnits
            .GroupBy(c => c.CustomerId)
            .Select(g =>
            {
                var first = g.First();
                return new Customer
                {
                    Id                   = first.CustomerId,
                    Name                 = first.CustomerName ?? string.Empty,
                    ScoularId            = first.ScoularId,
                    IndustryCode1        = first.IndustryCode1,
                    IsActive             = first.IsActive,
                    EffectiveStartDate   = first.EffectiveStartDate,
                    EffectiveEndDate     = first.EffectiveEndDate,
                    Phone                = first.MerchandisingPhone,
                    Email                = first.MerchandisingEmail,
                    ExtendedPrimaryPhone = first.ExtendedPrimaryPhone,
                    SupplementalEmail    = first.SupplementalEmail,
                    Location             = first.MerchandisingCity,
                    StateProvince        = first.MerchandisingStateProvince,
                    AddressLine1         = first.MerchandisingAddressLine1,
                    PostalCode           = first.MerchandisingPostalCode,
                    ExtendedAddressLine1 = first.ExtendedAddressLine1,
                    ExtendedAddressLine2 = first.ExtendedAddressLine2,
                    ExtendedAddressLine3 = first.ExtendedAddressLine3,
                    ExtendedAddressLine4 = first.ExtendedAddressLine4,
                    ExtendedCity         = first.ExtendedCity,
                    ExtendedPostalCode   = first.ExtendedPostalCode,
                    ExtendedStateProvince = first.ExtendedStateProvince,
                    ExtendedCountry      = first.ExtendedCountry
                };
            })
            .ToList();
        await _appContext.Customers.AddRangeAsync(customerRows, cancellationToken);

        // -------------------------------------------------------------------------
        // CustomerTradeUnit — one row per (CustomerId, TradeUnit) pair from the ODS view.
        // -------------------------------------------------------------------------
        var ctuRows = customerTradeUnits
            .Where(c => !string.IsNullOrEmpty(c.TradeUnit))
            .Select(c => new CustomerTradeUnit
            {
                CustomerId = c.CustomerId,
                TradeUnit  = c.TradeUnit!,
                IsActive   = c.IsActive
            })
            .ToList();
        await _appContext.CustomerTradeUnits.AddRangeAsync(ctuRows, cancellationToken);

        await _appContext.SaveChangesAsync(cancellationToken);

        // Re-enable the FK constraints we disabled above. WITH CHECK validates that
        // every existing Notes / ProducerDetails / ProducerPlantingIntentions row
        // still has a matching Customer — flags real orphans introduced by ODS
        // customer removals so they can be cleaned up.
        await _appContext.Database.ExecuteSqlRawAsync(enableFks, cancellationToken);

        sw.Stop();
        return Ok(new
        {
            CustomerRowsInserted          = customerRows.Count,
            CustomerTradeUnitRowsInserted = ctuRows.Count,
            ElapsedMs                     = sw.ElapsedMilliseconds
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
    public async Task<IActionResult> GetGeocodeStatus(CancellationToken ct = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var total = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive, ct);
        var withCoords = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive && e.Latitude != null, ct);
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
    public async Task<IActionResult> GeocodeByZip(CancellationToken ct = default)
    {
        if (DenyIfNotDevelopment() is { } deny) return deny;

        var missing = await _appContext.ElevatorCaches
            .Where(e => e.Latitude == null && e.IsActive && e.ZipCode != null && e.ZipCode != "0")
            .ToListAsync(ct);

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
                    await Task.Delay(100, ct); // Be polite
                    var response = await client.GetAsync($"https://api.zippopotam.us/us/{zip}", ct);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync(ct);
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
            if (updated % 100 == 0) await _appContext.SaveChangesAsync(ct);
        }

        await _appContext.SaveChangesAsync(ct);

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
