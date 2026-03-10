// System namespaces
using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class GeocodeController : ControllerBase
{
    // In-process cache shared across requests — keyed by normalised address string
    private static readonly ConcurrentDictionary<string, double[]?> _cache = new();
    private static readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private static DateTime _lastNominatimCall = DateTime.MinValue;

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GeocodeController> _logger;

    public GeocodeController(IHttpClientFactory httpFactory, ILogger<GeocodeController> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Geocodes a single address via Nominatim. Rate-limited to 1 req/sec.</summary>
    [HttpPost("single")]
    [ProducesResponseType(typeof(GeocodeResult), StatusCodes.Status200OK)]
    public async Task<ActionResult<GeocodeResult>> SingleGeocode([FromBody] GeocodeRequest request, CancellationToken cancellationToken = default)
    {
        if (request == null)
        {
            return Ok(new GeocodeResult());
        }

        var cacheKey = BuildCacheKey(request);

        if (_cache.TryGetValue(cacheKey, out var cached))
        {
            return Ok(new GeocodeResult { Key = request.Key, Lat = cached?[0], Lng = cached?[1] });
        }

        await _rateLimiter.WaitAsync(cancellationToken);
        try
        {
            // Enforce 1 request per second to Nominatim
            var elapsed = DateTime.UtcNow - _lastNominatimCall;
            if (elapsed.TotalMilliseconds < 1100)
            {
                await Task.Delay(1100 - (int)elapsed.TotalMilliseconds, cancellationToken);
            }

            var url = BuildNominatimUrl(request);
            _lastNominatimCall = DateTime.UtcNow;

            var http = _httpFactory.CreateClient("nominatim");
            var response = await http.GetAsync(url, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                var data = JsonSerializer.Deserialize<JsonElement[]>(json);
                if (data != null && data.Length > 0)
                {
                    var lat = double.Parse(data[0].GetProperty("lat").GetString()!);
                    var lng = double.Parse(data[0].GetProperty("lon").GetString()!);
                    _cache[cacheKey] = new[] { lat, lng };
                    return Ok(new GeocodeResult { Key = request.Key, Lat = lat, Lng = lng });
                }
                else
                {
                    _cache[cacheKey] = null;
                }
            }
            else if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                _logger.LogWarning("Nominatim rate limit hit for {CacheKey} [{ErrorCode}]", cacheKey, "INFRASTRUCTURE_GEOCODE_RATE_LIMITED");
            }
            else
            {
                _logger.LogWarning("Nominatim returned {StatusCode} for {CacheKey} [{ErrorCode}]",
                    (int)response.StatusCode, cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Geocode HTTP failure for {CacheKey} [{ErrorCode}]", cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Geocode request timed out for {CacheKey} [{ErrorCode}]", cacheKey, "INFRASTRUCTURE_TIMEOUT");
        }
        finally
        {
            _rateLimiter.Release();
        }

        return Ok(new GeocodeResult { Key = request.Key });
    }

    // -------------------------------------------------------------------------
    /// <summary>Batch geocodes up to 50 addresses via Nominatim. Rate-limited to 1 req/sec per address.</summary>
    [HttpPost("batch")]
    [ProducesResponseType(typeof(List<GeocodeResult>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<GeocodeResult>>> BatchGeocode([FromBody] List<GeocodeRequest> requests, CancellationToken cancellationToken = default)
    {
        if (requests == null || requests.Count == 0)
        {
            return Ok(new List<GeocodeResult>());
        }

        // Cap at 50 per request to avoid abuse
        if (requests.Count > 50)
        {
            requests = requests.Take(50).ToList();
        }

        var results = new List<GeocodeResult>();
        var http = _httpFactory.CreateClient("nominatim");
        var rateLimitAttempt = 0;

        foreach (var req in requests)
        {
            var cacheKey = BuildCacheKey(req);

            // Check in-memory cache first
            if (_cache.TryGetValue(cacheKey, out var cached))
            {
                results.Add(new GeocodeResult { Key = req.Key, Lat = cached?[0], Lng = cached?[1] });
                continue;
            }

            // Call Nominatim (server-to-server, no CORS)
            try
            {
                var url = BuildNominatimUrl(req);
                var response = await http.GetAsync(url, cancellationToken);

                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    // Exponential backoff with jitter per §6.2: min(baseDelay × 2^attempt + jitter, maxDelay)
                    var backoffMs = (int)Math.Min(500 * Math.Pow(2, rateLimitAttempt) + Random.Shared.Next(0, 200), 30_000);
                    _logger.LogWarning(
                        "Nominatim rate limit on batch item {CacheKey}. Backing off {BackoffMs}ms (attempt {Attempt}) [{ErrorCode}]",
                        cacheKey, backoffMs, rateLimitAttempt + 1, "INFRASTRUCTURE_GEOCODE_RATE_LIMITED");
                    await Task.Delay(backoffMs, cancellationToken);
                    rateLimitAttempt++;
                    results.Add(new GeocodeResult { Key = req.Key });
                    continue;
                }

                rateLimitAttempt = 0;

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync(cancellationToken);
                    var data = JsonSerializer.Deserialize<JsonElement[]>(json);
                    if (data != null && data.Length > 0)
                    {
                        var lat = double.Parse(data[0].GetProperty("lat").GetString()!);
                        var lng = double.Parse(data[0].GetProperty("lon").GetString()!);
                        _cache[cacheKey] = new[] { lat, lng };
                        results.Add(new GeocodeResult { Key = req.Key, Lat = lat, Lng = lng });
                    }
                    else
                    {
                        _cache[cacheKey] = null;
                        results.Add(new GeocodeResult { Key = req.Key });
                    }
                }
                else
                {
                    _logger.LogWarning("Nominatim returned {StatusCode} for batch item {CacheKey} [{ErrorCode}]",
                        (int)response.StatusCode, cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
                    results.Add(new GeocodeResult { Key = req.Key });
                }

                // Respect Nominatim rate limit: 1 req/sec
                await Task.Delay(1100, cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogWarning(ex, "Batch geocode HTTP failure for {CacheKey} [{ErrorCode}]", cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE");
                results.Add(new GeocodeResult { Key = req.Key });
            }
            catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Batch geocode timed out for {CacheKey} [{ErrorCode}]", cacheKey, "INFRASTRUCTURE_TIMEOUT");
                results.Add(new GeocodeResult { Key = req.Key });
            }
        }

        return Ok(results);
    }

    // -------------------------------------------------------------------------
    private static string BuildCacheKey(GeocodeRequest r)
    {
        var streetPart = string.IsNullOrWhiteSpace(r.Street) ? "" : r.Street.ToLower().Trim();
        return string.IsNullOrEmpty(streetPart)
            ? $"{r.City?.ToLower()},{r.State?.ToLower()},{r.Zip?.ToLower()}".Trim(',')
            : $"{streetPart},{r.City?.ToLower()},{r.State?.ToLower()},{r.Zip?.ToLower()}".Trim(',');
    }

    private static string BuildNominatimUrl(GeocodeRequest r)
    {
        var queryParams = new List<string> { "country=US", "format=json", "limit=1" };
        if (!string.IsNullOrWhiteSpace(r.Street)) queryParams.Add($"street={Uri.EscapeDataString(r.Street)}");
        if (!string.IsNullOrWhiteSpace(r.City)) queryParams.Add($"city={Uri.EscapeDataString(r.City)}");
        if (!string.IsNullOrWhiteSpace(r.State)) queryParams.Add($"state={Uri.EscapeDataString(r.State)}");
        if (!string.IsNullOrWhiteSpace(r.Zip)) queryParams.Add($"postalcode={Uri.EscapeDataString(r.Zip)}");
        return $"search?{string.Join("&", queryParams)}";
    }
}
