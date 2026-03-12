// System namespaces
using System.Net;
using System.Text.Json;

// Microsoft namespaces
using Microsoft.Extensions.Caching.Memory;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class GeocodeController : ControllerBase
{
    // Bounded cache with size limit and sliding expiration (CWE-400 / M-12)
    private static readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private static DateTime _lastNominatimCall = DateTime.MinValue;
    private static readonly MemoryCacheEntryOptions _cacheOptions = new()
    {
        SlidingExpiration = TimeSpan.FromHours(4),
        Size = 1
    };

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GeocodeController> _logger;
    private readonly IMemoryCache _cache;

    public GeocodeController(IHttpClientFactory httpFactory, ILogger<GeocodeController> logger, IMemoryCache cache)
    {
        _httpFactory = httpFactory;
        _logger = logger;
        _cache = cache;
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

        if (_cache.TryGetValue<double[]?>(cacheKey, out var cached))
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
                    _cache.Set(cacheKey, new[] { lat, lng }, _cacheOptions);
                    return Ok(new GeocodeResult { Key = request.Key, Lat = lat, Lng = lng });
                }
                else
                {
                    _cache.Set<double[]?>(cacheKey, null, _cacheOptions);
                }
            }
            else if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                _logger.LogError("Nominatim rate limit hit for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                    cacheKey, "INFRASTRUCTURE_GEOCODE_RATE_LIMITED", "Infrastructure");
            }
            else
            {
                _logger.LogError("Nominatim returned {StatusCode} for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                    (int)response.StatusCode, cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Geocode HTTP failure for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(ex, "Geocode request timed out for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                cacheKey, "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
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
            if (_cache.TryGetValue<double[]?>(cacheKey, out var cached))
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
                    _logger.LogError(
                        "Nominatim rate limit on batch item {CacheKey}. Backing off {BackoffMs}ms (attempt {Attempt}) [{ErrorCode}] [{ErrorCategory}]",
                        cacheKey, backoffMs, rateLimitAttempt + 1, "INFRASTRUCTURE_GEOCODE_RATE_LIMITED", "Infrastructure");
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
                        _cache.Set(cacheKey, new[] { lat, lng }, _cacheOptions);
                        results.Add(new GeocodeResult { Key = req.Key, Lat = lat, Lng = lng });
                    }
                    else
                    {
                        _cache.Set<double[]?>(cacheKey, null, _cacheOptions);
                        results.Add(new GeocodeResult { Key = req.Key });
                    }
                }
                else
                {
                    _logger.LogError("Nominatim returned {StatusCode} for batch item {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                        (int)response.StatusCode, cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
                    results.Add(new GeocodeResult { Key = req.Key });
                }

                // Respect Nominatim rate limit: 1 req/sec
                await Task.Delay(1100, cancellationToken);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Batch geocode HTTP failure for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                    cacheKey, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
                results.Add(new GeocodeResult { Key = req.Key });
            }
            catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "Batch geocode timed out for {CacheKey} [{ErrorCode}] [{ErrorCategory}]",
                    cacheKey, "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
                results.Add(new GeocodeResult { Key = req.Key });
            }
        }

        return Ok(results);
    }

    // -------------------------------------------------------------------------
    /// <summary>Free-text geocode search via Nominatim (proxied server-side). Rate-limited to 1 req/sec.</summary>
    [HttpGet("search")]
    [ProducesResponseType(typeof(List<GeocodeSearchResult>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<GeocodeSearchResult>>> Search([FromQuery] string q, [FromQuery] int limit = 1, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(q))
            return Ok(new List<GeocodeSearchResult>());

        // Cap limit at 5 to prevent abuse
        limit = Math.Clamp(limit, 1, 5);

        var cacheKey = $"search:{q.ToLower().Trim()}:{limit}";
        if (_cache.TryGetValue<double[]?>(cacheKey, out var cached) && cached != null)
        {
            return Ok(new List<GeocodeSearchResult>
            {
                new() { Lat = cached[0], Lng = cached[1] }
            });
        }

        await _rateLimiter.WaitAsync(cancellationToken);
        try
        {
            var elapsed = DateTime.UtcNow - _lastNominatimCall;
            if (elapsed.TotalMilliseconds < 1100)
            {
                await Task.Delay(1100 - (int)elapsed.TotalMilliseconds, cancellationToken);
            }

            var url = $"search?q={Uri.EscapeDataString(q)}&format=json&limit={limit}";
            _lastNominatimCall = DateTime.UtcNow;

            var http = _httpFactory.CreateClient("nominatim");
            var response = await http.GetAsync(url, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                var data = JsonSerializer.Deserialize<JsonElement[]>(json);
                if (data != null && data.Length > 0)
                {
                    var results = data.Select(d => new GeocodeSearchResult
                    {
                        Lat = double.Parse(d.GetProperty("lat").GetString()!),
                        Lng = double.Parse(d.GetProperty("lon").GetString()!)
                    }).ToList();

                    // Cache first result
                    _cache.Set(cacheKey, new[] { results[0].Lat, results[0].Lng }, _cacheOptions);
                    return Ok(results);
                }
            }
            else
            {
                _logger.LogError("Nominatim search returned {StatusCode} for query {Query} [{ErrorCode}] [{ErrorCategory}]",
                    (int)response.StatusCode, q, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Geocode search HTTP failure for query {Query} [{ErrorCode}] [{ErrorCategory}]",
                q, "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError(ex, "Geocode search timed out for query {Query} [{ErrorCode}] [{ErrorCategory}]",
                q, "INFRASTRUCTURE_TIMEOUT", "Infrastructure");
        }
        finally
        {
            _rateLimiter.Release();
        }

        return Ok(new List<GeocodeSearchResult>());
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
