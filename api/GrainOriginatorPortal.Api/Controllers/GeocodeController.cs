using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GeocodeController : ControllerBase
{
    private static readonly ConcurrentDictionary<string, double[]?> _cache = new();
    private static readonly HttpClient _http = new()
    {
        DefaultRequestHeaders = { { "User-Agent", "GrainOriginatorPortal/1.0" } }
    };
    private static readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private static DateTime _lastNominatimCall = DateTime.MinValue;
    private readonly ILogger<GeocodeController> _logger;

    public GeocodeController(ILogger<GeocodeController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Geocode a single address via Nominatim (server-side, no CORS issues).
    /// Rate-limited to 1 request/sec to respect Nominatim usage policy.
    /// </summary>
    [HttpPost("single")]
    public async Task<ActionResult<GeocodeResult>> SingleGeocode([FromBody] GeocodeRequest request)
    {
        if (request == null) return Ok(new GeocodeResult());

        var cacheKey = $"{request.City?.ToLower()},{request.State?.ToLower()},{request.Zip?.ToLower()}".Trim(',');

        if (_cache.TryGetValue(cacheKey, out var cached))
        {
            return Ok(new GeocodeResult { Key = request.Key, Lat = cached?[0], Lng = cached?[1] });
        }

        await _rateLimiter.WaitAsync();
        try
        {
            // Enforce 1 request per second to Nominatim
            var elapsed = DateTime.UtcNow - _lastNominatimCall;
            if (elapsed.TotalMilliseconds < 1100)
                await Task.Delay(1100 - (int)elapsed.TotalMilliseconds);

            var queryParams = new List<string> { "country=US", "format=json", "limit=1" };
            if (!string.IsNullOrWhiteSpace(request.City)) queryParams.Add($"city={Uri.EscapeDataString(request.City)}");
            if (!string.IsNullOrWhiteSpace(request.State)) queryParams.Add($"state={Uri.EscapeDataString(request.State)}");
            if (!string.IsNullOrWhiteSpace(request.Zip)) queryParams.Add($"postalcode={Uri.EscapeDataString(request.Zip)}");

            var url = $"https://nominatim.openstreetmap.org/search?{string.Join("&", queryParams)}";
            _lastNominatimCall = DateTime.UtcNow;
            var response = await _http.GetAsync(url);

            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
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
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Geocode failed for address {CacheKey}", cacheKey);
        }
        finally
        {
            _rateLimiter.Release();
        }

        return Ok(new GeocodeResult { Key = request.Key });
    }

    /// <summary>
    /// Batch geocode multiple addresses via Nominatim (server-side, no CORS issues).
    /// </summary>
    [HttpPost("batch")]
    public async Task<ActionResult<List<GeocodeResult>>> BatchGeocode([FromBody] List<GeocodeRequest> requests)
    {
        if (requests == null || requests.Count == 0)
            return Ok(new List<GeocodeResult>());

        // Cap at 50 per request to avoid abuse
        if (requests.Count > 50)
            requests = requests.Take(50).ToList();

        var results = new List<GeocodeResult>();

        foreach (var req in requests)
        {
            var cacheKey = $"{req.City?.ToLower()},{req.State?.ToLower()},{req.Zip?.ToLower()}".Trim(',');

            // Check in-memory cache first
            if (_cache.TryGetValue(cacheKey, out var cached))
            {
                results.Add(new GeocodeResult
                {
                    Key = req.Key,
                    Lat = cached?[0],
                    Lng = cached?[1]
                });
                continue;
            }

            // Call Nominatim (server-to-server, no CORS)
            try
            {
                var queryParams = new List<string> { "country=US", "format=json", "limit=1" };
                if (!string.IsNullOrWhiteSpace(req.City)) queryParams.Add($"city={Uri.EscapeDataString(req.City)}");
                if (!string.IsNullOrWhiteSpace(req.State)) queryParams.Add($"state={Uri.EscapeDataString(req.State)}");
                if (!string.IsNullOrWhiteSpace(req.Zip)) queryParams.Add($"postalcode={Uri.EscapeDataString(req.Zip)}");

                var url = $"https://nominatim.openstreetmap.org/search?{string.Join("&", queryParams)}";
                var response = await _http.GetAsync(url);

                if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                {
                    // Rate limited — wait 2s and continue with remaining
                    await Task.Delay(2000);
                    results.Add(new GeocodeResult { Key = req.Key });
                    continue;
                }

                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
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
                    results.Add(new GeocodeResult { Key = req.Key });
                }

                // Respect Nominatim rate limit: 1 req/sec
                await Task.Delay(1100);
            }
            catch
            {
                results.Add(new GeocodeResult { Key = req.Key });
            }
        }

        return Ok(results);
    }
}

public class GeocodeRequest
{
    public string Key { get; set; } = string.Empty;
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Zip { get; set; }
}

public class GeocodeResult
{
    public string Key { get; set; } = string.Empty;
    public double? Lat { get; set; }
    public double? Lng { get; set; }
}
