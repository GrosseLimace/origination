using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
/// <remarks>
/// Registered as a singleton so the batch throttle and last-call timestamp are shared across
/// requests. Backed by the Azure Maps Search/Geocoding REST API (Get Geocoding, api-version
/// 2023-06-01), reusing the same subscription key already configured for map tile rendering
/// (FieldTags:AzureMapsKey). This replaced a Nominatim (OpenStreetMap)-backed implementation:
/// live testing showed Nominatim's structured address search returned zero results for rural
/// addresses with non-standard numbering (e.g. "77040 ROAD 330, OGALLALA, NE" and
/// "8888 COUNTY ROAD 23, STERLING, CO"), while Azure Maps' Get Geocoding endpoint resolved both
/// to precise rooftop-level points. Azure Maps' documented single-request Search QPS limit
/// (500 on Gen2, 50 on Gen1 S0) is far looser than Nominatim's 1 req/sec usage policy, so the
/// artificial per-call delay used for Nominatim has been dropped; a lighter delay remains only
/// on the batch path as a conservative guard against bursting the 10 QPS batch/search-batch limit.
/// </remarks>
public class GeocodeService : IGeocodeService
{
    private const string ApiVersion = "2023-06-01";

    // Conservative spacing between batch items — Azure Maps' documented Search Batch QPS limit is
    // 10/sec; 110ms keeps us under that with margin even though this loop calls the single-request
    // endpoint (whose own limit, 500 QPS on Gen2, is far higher) rather than the dedicated batch API.
    private const int BatchItemDelayMs = 110;

    // Bounded cache with size limit and sliding expiration (CWE-400 / M-12)
    private static readonly MemoryCacheEntryOptions _cacheOptions = new()
    {
        SlidingExpiration = TimeSpan.FromHours(4),
        Size = 1
    };

    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<GeocodeService> _logger;
    private readonly IMemoryCache _cache;

    public GeocodeService(IHttpClientFactory httpFactory, IConfiguration configuration, ILogger<GeocodeService> logger, IMemoryCache cache)
    {
        _httpFactory = httpFactory;
        _configuration = configuration;
        _logger = logger;
        _cache = cache;
    }

    /// <inheritdoc />
    public async Task<GeocodeResult> GeocodeSingleAsync(GeocodeRequest? request, CancellationToken cancellationToken)
    {
        if (request == null)
        {
            return new GeocodeResult();
        }

        var cacheKey = BuildCacheKey(request);

        if (_cache.TryGetValue<double[]?>(cacheKey, out var cached))
        {
            return new GeocodeResult { Key = request.Key, Lat = cached?[0], Lng = cached?[1] };
        }

        var apiKey = GetApiKey();
        if (apiKey == null)
        {
            _logger.LogError("Azure Maps key missing for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_MISCONFIGURED", "Infrastructure");
            return new GeocodeResult { Key = request.Key };
        }

        try
        {
            var url = BuildAzureMapsGeocodeUrl(request, apiKey);
            var http = _httpFactory.CreateClient("azuremaps");
            var response = await http.GetAsync(url, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                var point = ParseFirstFeaturePoint(json);
                if (point != null)
                {
                    _cache.Set(cacheKey, point, _cacheOptions);
                    return new GeocodeResult { Key = request.Key, Lat = point[0], Lng = point[1] };
                }
                else
                {
                    _cache.Set<double[]?>(cacheKey, null, _cacheOptions);
                }
            }
            else if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                _logger.LogError("Azure Maps rate limit hit for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                    Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_RATE_LIMITED", "Infrastructure");
            }
            else
            {
                _logger.LogError("Azure Maps returned {StatusCode} for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                    (int)response.StatusCode, Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Geocode HTTP failure for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(ex, "Geocode request timed out for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                Fingerprint(cacheKey), "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
        }

        return new GeocodeResult { Key = request.Key };
    }

    /// <inheritdoc />
    public async Task<List<GeocodeResult>> GeocodeBatchAsync(List<GeocodeRequest>? requests, CancellationToken cancellationToken)
    {
        if (requests == null || requests.Count == 0)
        {
            return new List<GeocodeResult>();
        }

        // Cap at 50 per request to avoid abuse
        if (requests.Count > 50)
        {
            requests = requests.Take(50).ToList();
        }

        var apiKey = GetApiKey();
        if (apiKey == null)
        {
            _logger.LogError("Azure Maps key missing for batch geocode request [{ErrorCode}] [{ErrorCategory}]",
                "INFRASTRUCTURE_GEOCODE_MISCONFIGURED", "Infrastructure");
            return requests.Select(r => new GeocodeResult { Key = r.Key }).ToList();
        }

        var results = new List<GeocodeResult>();
        var http = _httpFactory.CreateClient("azuremaps");
        var rateLimitAttempt = 0;

        foreach (var req in requests)
        {
            var cacheKey = BuildCacheKey(req);

            // Check in-memory cache first
            if (_cache.TryGetValue<double[]?>(cacheKey, out var cached))
            {
                results.Add(new GeocodeResult { Key = req.Key, Lat = cached?[0], Lng = cached?[1] });
                continue;
            }

            try
            {
                var url = BuildAzureMapsGeocodeUrl(req, apiKey);
                var response = await http.GetAsync(url, cancellationToken);

                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    // Exponential backoff with jitter per §6.2: min(baseDelay × 2^attempt + jitter, maxDelay)
                    var backoffMs = (int)Math.Min(500 * Math.Pow(2, rateLimitAttempt) + Random.Shared.Next(0, 200), 30_000);
                    _logger.LogError(
                        "Azure Maps rate limit on batch item {KeyHash}. Backing off {BackoffMs}ms (attempt {Attempt}) [{ErrorCode}] [{ErrorCategory}]",
                        Fingerprint(cacheKey), backoffMs, rateLimitAttempt + 1, "INFRASTRUCTURE_GEOCODE_RATE_LIMITED", "Infrastructure");
                    await Task.Delay(backoffMs, cancellationToken);
                    rateLimitAttempt++;
                    results.Add(new GeocodeResult { Key = req.Key });
                    continue;
                }

                rateLimitAttempt = 0;

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync(cancellationToken);
                    var point = ParseFirstFeaturePoint(json);
                    if (point != null)
                    {
                        _cache.Set(cacheKey, point, _cacheOptions);
                        results.Add(new GeocodeResult { Key = req.Key, Lat = point[0], Lng = point[1] });
                    }
                    else
                    {
                        _cache.Set<double[]?>(cacheKey, null, _cacheOptions);
                        results.Add(new GeocodeResult { Key = req.Key });
                    }
                }
                else
                {
                    _logger.LogError("Azure Maps returned {StatusCode} for batch item {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                        (int)response.StatusCode, Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
                    results.Add(new GeocodeResult { Key = req.Key });
                }

                // Conservative spacing — see BatchItemDelayMs remarks above.
                await Task.Delay(BatchItemDelayMs, cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Batch geocode HTTP failure for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                    Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
                results.Add(new GeocodeResult { Key = req.Key });
            }
            catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "Batch geocode timed out for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                    Fingerprint(cacheKey), "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
                results.Add(new GeocodeResult { Key = req.Key });
            }
        }

        return results;
    }

    /// <inheritdoc />
    public async Task<List<GeocodeSearchResult>> SearchAsync(string q, int limit, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(q))
            return new List<GeocodeSearchResult>();

        // Cap limit at 5 to prevent abuse
        limit = Math.Clamp(limit, 1, 5);

        var cacheKey = $"search:{q.ToLower().Trim()}:{limit}";
        if (_cache.TryGetValue<double[]?>(cacheKey, out var cached) && cached != null)
        {
            return new List<GeocodeSearchResult>
            {
                new() { Lat = cached[0], Lng = cached[1] }
            };
        }

        var apiKey = GetApiKey();
        if (apiKey == null)
        {
            _logger.LogError("Azure Maps key missing for search query [{ErrorCode}] [{ErrorCategory}]",
                "INFRASTRUCTURE_GEOCODE_MISCONFIGURED", "Infrastructure");
            return new List<GeocodeSearchResult>();
        }

        try
        {
            var url = $"geocode?api-version={ApiVersion}&subscription-key={apiKey}&query={Uri.EscapeDataString(q)}&top={limit}&countryRegion=US";

            var http = _httpFactory.CreateClient("azuremaps");
            var response = await http.GetAsync(url, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                var points = ParseFeaturePoints(json);
                if (points.Count > 0)
                {
                    var results = points.Select(p => new GeocodeSearchResult { Lat = p[0], Lng = p[1] }).ToList();

                    // Cache first result
                    _cache.Set(cacheKey, new[] { results[0].Lat, results[0].Lng }, _cacheOptions);
                    return results;
                }
            }
            else
            {
                _logger.LogError("Azure Maps search returned {StatusCode} for query {QueryHash} [{ErrorCode}] [{ErrorCategory}]",
                    (int)response.StatusCode, Fingerprint(q), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Geocode search HTTP failure for query {QueryHash} [{ErrorCode}] [{ErrorCategory}]",
                Fingerprint(q), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(ex, "Geocode search timed out for query {QueryHash} [{ErrorCode}] [{ErrorCategory}]",
                Fingerprint(q), "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
        }

        return new List<GeocodeSearchResult>();
    }

    // -------------------------------------------------------------------------
    private string? GetApiKey()
    {
        var key = _configuration["FieldTags:AzureMapsKey"];
        return string.IsNullOrWhiteSpace(key) ? null : key;
    }

    private static string BuildCacheKey(GeocodeRequest r)
    {
        var streetPart = string.IsNullOrWhiteSpace(r.Street) ? "" : r.Street.ToLower().Trim();
        return string.IsNullOrEmpty(streetPart)
            ? $"{r.City?.ToLower()},{r.State?.ToLower()},{r.Zip?.ToLower()}".Trim(',')
            : $"{streetPart},{r.City?.ToLower()},{r.State?.ToLower()},{r.Zip?.ToLower()}".Trim(',');
    }

    private static string BuildAzureMapsGeocodeUrl(GeocodeRequest r, string apiKey)
    {
        var queryParams = new List<string>
        {
            $"api-version={ApiVersion}",
            $"subscription-key={apiKey}",
            "countryRegion=US",
            "top=1"
        };
        if (!string.IsNullOrWhiteSpace(r.Street)) queryParams.Add($"addressLine={Uri.EscapeDataString(r.Street)}");
        if (!string.IsNullOrWhiteSpace(r.City)) queryParams.Add($"locality={Uri.EscapeDataString(r.City)}");
        if (!string.IsNullOrWhiteSpace(r.State)) queryParams.Add($"adminDistrict={Uri.EscapeDataString(r.State)}");
        if (!string.IsNullOrWhiteSpace(r.Zip)) queryParams.Add($"postalCode={Uri.EscapeDataString(r.Zip)}");
        return $"geocode?{string.Join("&", queryParams)}";
    }

    /// <summary>
    /// Parses the [lat, lng] point from the first feature of an Azure Maps Get Geocoding
    /// GeoJSON FeatureCollection response, or null if no features were returned.
    /// </summary>
    private static double[]? ParseFirstFeaturePoint(string json)
    {
        var points = ParseFeaturePoints(json, maxCount: 1);
        return points.Count > 0 ? points[0] : null;
    }

    /// <summary>
    /// Parses [lat, lng] points (in feature order) from an Azure Maps Get Geocoding GeoJSON
    /// FeatureCollection response. GeoJSON orders coordinates as [lon, lat], so this flips them
    /// to the [lat, lng] convention used by GeocodeResult/GeocodeSearchResult.
    /// </summary>
    private static List<double[]> ParseFeaturePoints(string json, int? maxCount = null)
    {
        var points = new List<double[]>();
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("features", out var features) || features.ValueKind != JsonValueKind.Array)
        {
            return points;
        }

        foreach (var feature in features.EnumerateArray())
        {
            if (maxCount.HasValue && points.Count >= maxCount.Value) break;

            if (!feature.TryGetProperty("geometry", out var geometry)) continue;
            if (!geometry.TryGetProperty("coordinates", out var coordinates)) continue;
            if (coordinates.ValueKind != JsonValueKind.Array || coordinates.GetArrayLength() < 2) continue;

            var lon = coordinates[0].GetDouble();
            var lat = coordinates[1].GetDouble();
            points.Add(new[] { lat, lon });
        }

        return points;
    }

    // -------------------------------------------------------------------------
    /// <summary>
    /// One-way short hash of caller-supplied address/query text for log correlation. The raw cache
    /// key and search string are built from street/city/state/ZIP/free-text, so they must never be
    /// written to long-lived logs (M-014). The 12-hex-char SHA-256 prefix lets operators correlate
    /// repeated failures for the same input without persisting the address itself.
    /// </summary>
    private static string Fingerprint(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty));
        return Convert.ToHexString(hash, 0, 6);
    }
}
