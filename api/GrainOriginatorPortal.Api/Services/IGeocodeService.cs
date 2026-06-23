using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Server-side geocoding via Nominatim (proxied, cached, and globally rate-limited to
/// 1 req/sec). Owns the HttpClient, response cache, and rate-limiter so the controller stays thin.</summary>
public interface IGeocodeService
{
    Task<GeocodeResult> GeocodeSingleAsync(GeocodeRequest? request, CancellationToken cancellationToken);
    Task<List<GeocodeResult>> GeocodeBatchAsync(List<GeocodeRequest>? requests, CancellationToken cancellationToken);
    Task<List<GeocodeSearchResult>> SearchAsync(string q, int limit, CancellationToken cancellationToken);
}
