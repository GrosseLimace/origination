using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Server-side geocoding via the Azure Maps Search/Geocoding REST API (proxied and
/// cached). Owns the HttpClient and response cache so the controller stays thin.</summary>
public interface IGeocodeService
{
    Task<GeocodeResult> GeocodeSingleAsync(GeocodeRequest? request, CancellationToken cancellationToken);
    Task<List<GeocodeResult>> GeocodeBatchAsync(List<GeocodeRequest>? requests, CancellationToken cancellationToken);
    Task<List<GeocodeSearchResult>> SearchAsync(string q, int limit, CancellationToken cancellationToken);
}
