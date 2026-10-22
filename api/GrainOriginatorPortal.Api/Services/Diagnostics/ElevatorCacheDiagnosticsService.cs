// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer). The per-item swallow-and-count in the
/// geocoding loops is deliberate: one unreachable address must not abort a 1 req/sec walk over the
/// whole elevator list, so those loops report counts instead of throwing.
/// </summary>
public sealed class ElevatorCacheDiagnosticsService : IElevatorCacheDiagnosticsService
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ElevatorCacheDiagnosticsService> _logger;

    // Process-wide: at most one background geocoding run, regardless of which request scope started it.
    private static int _isGeocoding;

    public ElevatorCacheDiagnosticsService(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        IHttpClientFactory httpFactory,
        IServiceScopeFactory scopeFactory,
        ILogger<ElevatorCacheDiagnosticsService> logger)
    {
        _context = context;
        _appContext = appContext;
        _httpFactory = httpFactory;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    public async Task<ElevatorCacheRefreshResult> RefreshAsync(bool geocode, CancellationToken cancellationToken)
    {
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

            (geocoded, geoFailed) = await GeocodeElevatorsAsync(
                toGeocode, _httpFactory, _logger, saveEvery: null, _appContext, cancellationToken);

            await _appContext.SaveChangesAsync(cancellationToken);
        }

        sw.Stop();
        return new ElevatorCacheRefreshResult(
            OdsTotal: odsElevators.Count,
            Inserted: inserted,
            Updated: updated,
            Geocoded: geocoded,
            GeoFailed: geoFailed,
            ElapsedSeconds: sw.Elapsed.TotalSeconds);
    }

    // -------------------------------------------------------------------------
    // No CancellationToken parameter: this is fire-and-forget. The background Task.Run below
    // deliberately outlives the request and takes a fresh scope, so a request-scoped token would
    // be cancelled the moment the controller returns 202.
    public ElevatorGeocodeStarted? TryStartBackgroundGeocode()
    {
        if (Interlocked.CompareExchange(ref _isGeocoding, 1, 0) != 0)
            return null;

        var missing = _appContext.ElevatorCaches
            .Count(e => e.Latitude == null && e.IsActive && (e.City != null || e.Address != null));

        // The scope factory is a root-level singleton, so it is safe to use after this request ends
        var serviceProvider = _scopeFactory;
        _ = Task.Run(async () =>
        {
            try { await GeocodeElevatorsBackground(serviceProvider); }
            finally { Interlocked.Exchange(ref _isGeocoding, 0); }
        });

        return new ElevatorGeocodeStarted(
            Message: "Geocoding started in background",
            ElevatorsToGeocode: missing,
            EstimatedMinutes: Math.Ceiling(missing * 1.1 / 60.0));
    }

    // -------------------------------------------------------------------------
    public async Task<ElevatorGeocodeStatus> GetGeocodeStatusAsync(CancellationToken cancellationToken)
    {
        var total = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive, cancellationToken);
        var withCoords = await _appContext.ElevatorCaches.CountAsync(e => e.IsActive && e.Latitude != null, cancellationToken);
        var missing = total - withCoords;

        return new ElevatorGeocodeStatus(
            Total: total,
            WithCoordinates: withCoords,
            MissingCoordinates: missing,
            PercentComplete: total > 0 ? Math.Round(100.0 * withCoords / total, 1) : 0);
    }

    private async Task GeocodeElevatorsBackground(IServiceScopeFactory scopeFactory)
    {
        try
        {
            // Create a new scope since the request's DbContext will be disposed
            using var scope = scopeFactory.CreateScope();
            var appContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var httpFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
            var logger = scope.ServiceProvider.GetRequiredService<ILogger<ElevatorCacheDiagnosticsService>>();

            var toGeocode = await appContext.ElevatorCaches
                .Where(e => e.Latitude == null && e.IsActive)
                .Where(e => e.City != null || e.Address != null)
                .ToListAsync();

            var (done, failed) = await GeocodeElevatorsAsync(
                toGeocode, httpFactory, logger, saveEvery: 50, appContext, CancellationToken.None);

            await appContext.SaveChangesAsync();
            logger.LogInformation("Elevator geocoding complete: {Done} geocoded, {Failed} failed", done, failed);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Background elevator geocoding crashed");
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// Fills in Latitude/Longitude for elevators that lack them, writing onto the tracked entities
    /// (the caller saves). Returns (geocoded, failed).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Both the synchronous refresh and the fire-and-forget background job used to carry their own
    /// near-identical copy of this loop — same query assembly, same 1.1s pacing, same JSON
    /// parsing, same swallow-and-count — so a fix to one silently missed the other.
    /// </para>
    /// <para>
    /// Uses the named "nominatim" client, which Program.cs wires with a 10s timeout, 3-attempt
    /// exponential backoff and a circuit breaker. The old code took a bare, unconfigured client, so
    /// a Nominatim outage burned through the whole elevator list with no protection at all. The
    /// query text is deliberately unchanged (free-text <c>q=</c> rather than
    /// IGeocodeService's structured street/city/state parameters): routing through the service
    /// would also change which addresses match, and that belongs in its own change with a look at
    /// the resulting coordinates.
    /// </para>
    /// <para>
    /// <paramref name="appContext"/> is only touched when <paramref name="saveEvery"/> is set
    /// (periodic checkpoint); with <c>null</c> the caller owns the save.
    /// </para>
    /// </remarks>
    internal static async Task<(int Geocoded, int Failed)> GeocodeElevatorsAsync(
        List<ElevatorCache> toGeocode,
        IHttpClientFactory httpFactory,
        ILogger logger,
        int? saveEvery,
        ApplicationDbContext appContext,
        CancellationToken cancellationToken)
    {
        var client = httpFactory.CreateClient("nominatim");
        int done = 0, failed = 0;

        foreach (var elev in toGeocode)
        {
            if (cancellationToken.IsCancellationRequested) break;

            var parts = new[] { elev.Address?.Trim(), elev.City?.Trim(), elev.State?.Trim() }
                .Where(p => !string.IsNullOrWhiteSpace(p));
            var query = string.Join(", ", parts);
            if (string.IsNullOrWhiteSpace(query)) { failed++; continue; }

            try
            {
                // Nominatim's usage policy is 1 req/sec. This is a Dev/QA-only admin job, so it
                // paces itself rather than contending for GeocodeService's shared limiter.
                await Task.Delay(1100, cancellationToken);
                var response = await client.GetAsync(
                    $"search?format=json&limit=1&q={Uri.EscapeDataString(query)}", cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync(cancellationToken);
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

                // Checkpoint periodically so a long run doesn't lose everything if it dies.
                if (saveEvery is { } n && (done + failed) % n == 0)
                    await appContext.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Geocoding failed for {Code}", elev.ElevatorCode);
                failed++;
            }
        }

        return (done, failed);
    }

    // -------------------------------------------------------------------------
    public async Task<object> GeocodeByZipAsync(CancellationToken cancellationToken)
    {
        var missing = await _appContext.ElevatorCaches
            .Where(e => e.Latitude == null && e.IsActive && e.ZipCode != null && e.ZipCode != "0")
            .ToListAsync(cancellationToken);

        if (missing.Count == 0)
            return new { Message = "No elevators need zip-based geocoding", Updated = 0 };

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

        return new
        {
            Message = "Zip-based geocoding complete",
            UniqueZips = byZip.Count,
            Updated = updated,
            Failed = failed
        };
    }
}
