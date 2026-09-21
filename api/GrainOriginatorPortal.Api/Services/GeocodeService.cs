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
/// <remarks>Registered as a singleton so the rate-limiter and last-call timestamp are shared across
/// requests, enforcing Nominatim's global 1-req/sec limit.</remarks>
public class GeocodeService : IGeocodeService
{
    // Bounded cache with size limit and sliding expiration (CWE-400 / M-12)
    private readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private DateTime _lastNominatimCall = DateTime.MinValue;
    private static readonly MemoryCacheEntryOptions _cacheOptions = new()
    {
        SlidingExpiration = TimeSpan.FromHours(4),
        Size = 1
    };

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GeocodeService> _logger;
    private readonly IMemoryCache _cache;

    public GeocodeService(IHttpClientFactory httpFactory, ILogger<GeocodeService> logger, IMemoryCache cache)
    {
        _httpFactory = httpFactory;
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
                    return new GeocodeResult { Key = request.Key, Lat = lat, Lng = lng };
                }
                else
                {
                    _cache.Set<double[]?>(cacheKey, null, _cacheOptions);
                }
            }
            else if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                _logger.LogError("Nominatim rate limit hit for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                    Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_RATE_LIMITED", "Infrastructure");
            }
            else
            {
                _logger.LogError("Nominatim returned {StatusCode} for {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
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
        finally
        {
            _rateLimiter.Release();
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

            // Call Nominatim (server-to-server, no CORS).
            // Take the shared slot per item, same as GeocodeSingleAsync/SearchAsync: the loop's own
            // delay only paced THIS batch, so two concurrent callers could still fire at Nominatim
            // simultaneously and blow the documented 1 req/sec limit (risking an IP-level block that
            // breaks geocoding app-wide). Acquiring per item rather than for the whole batch keeps a
            // 50-item batch from monopolising the limiter for a minute.
            await _rateLimiter.WaitAsync(cancellationToken);
            try
            {
                var elapsed = DateTime.UtcNow - _lastNominatimCall;
                if (elapsed.TotalMilliseconds < 1100)
                {
                    await Task.Delay(1100 - (int)elapsed.TotalMilliseconds, cancellationToken);
                }

                var url = BuildNominatimUrl(req);
                _lastNominatimCall = DateTime.UtcNow;
                var response = await http.GetAsync(url, cancellationToken);

                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    // Exponential backoff with jitter per §6.2: min(baseDelay × 2^attempt + jitter, maxDelay)
                    var backoffMs = (int)Math.Min(500 * Math.Pow(2, rateLimitAttempt) + Random.Shared.Next(0, 200), 30_000);
                    _logger.LogError(
                        "Nominatim rate limit on batch item {KeyHash}. Backing off {BackoffMs}ms (attempt {Attempt}) [{ErrorCode}] [{ErrorCategory}]",
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
                    _logger.LogError("Nominatim returned {StatusCode} for batch item {KeyHash} [{ErrorCode}] [{ErrorCategory}]",
                        (int)response.StatusCode, Fingerprint(cacheKey), "INFRASTRUCTURE_GEOCODE_UNAVAILABLE", "Infrastructure");
                    results.Add(new GeocodeResult { Key = req.Key });
                }
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
            finally
            {
                _rateLimiter.Release();
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

        // Cache the WHOLE result list, not just the first point. Caching only results[0] meant an
        // identical repeat search silently returned 1 candidate where the first call returned up to
        // 5 — the disambiguation dropdown would collapse to a single option on the second try.
        var cacheKey = $"search:{q.ToLower().Trim()}:{limit}";
        if (_cache.TryGetValue<List<GeocodeSearchResult>>(cacheKey, out var cached) && cached != null)
        {
            return cached;
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

                    _cache.Set(cacheKey, results, _cacheOptions);
                    return results;
                }
            }
            else
            {
                _logger.LogError("Nominatim search returned {StatusCode} for query {QueryHash} [{ErrorCode}] [{ErrorCategory}]",
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
        finally
        {
            _rateLimiter.Release();
        }

        return new List<GeocodeSearchResult>();
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
