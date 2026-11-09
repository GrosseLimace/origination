using GrainOriginatorPortal.Api.Platform.Geocode.Models.Requests;
using GrainOriginatorPortal.Api.Platform.Geocode.Models.Responses;

namespace GrainOriginatorPortal.Api.Platform.Geocode;

/// <summary>Server-side geocoding via Nominatim (proxied, cached, and globally rate-limited to
/// 1 req/sec). Owns the HttpClient, response cache, and rate-limiter so the controller stays thin.</summary>
public interface IGeocodeService
{
    Task<GeocodeResult> GeocodeSingleAsync(GeocodeRequest? request, CancellationToken cancellationToken);
    Task<List<GeocodeResult>> GeocodeBatchAsync(List<GeocodeRequest>? requests, CancellationToken cancellationToken);
    Task<List<GeocodeSearchResult>> SearchAsync(string q, int limit, CancellationToken cancellationToken);
}
