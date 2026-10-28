namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// dbo.ElevatorCache maintenance behind the Dev/QA-only diagnostics routes
/// (<c>elevator-cache/refresh</c>, <c>elevator-cache/geocode</c>, <c>elevator-cache/geocode-status</c>,
/// <c>elevator-cache/geocode-zip</c>). The environment gate and the HTTP status mapping
/// (202 / 409) stay in the controller.
/// </summary>
public interface IElevatorCacheDiagnosticsService
{
    /// <summary>
    /// Copies all elevators from ODS ctrm.vw_GNP026 into dbo.ElevatorCache.
    /// Upserts by ElevatorCode — existing rows are updated, new rows are inserted.
    /// Optionally geocodes elevators missing coordinates (<paramref name="geocode"/>, slow ~1 req/sec).
    /// </summary>
    Task<ElevatorCacheRefreshResult> RefreshAsync(bool geocode, CancellationToken cancellationToken);

    /// <summary>
    /// Starts geocoding all elevators missing coordinates in the background and returns immediately
    /// with the estimated time. Returns <c>null</c> when a run is already in progress (the caller
    /// answers 409). Progress is read via <see cref="GetGeocodeStatusAsync"/>.
    /// </summary>
    ElevatorGeocodeStarted? TryStartBackgroundGeocode();

    /// <summary>Returns current geocoding progress.</summary>
    Task<ElevatorGeocodeStatus> GetGeocodeStatusAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Geocode missing elevators using zip code centroids (zippopotam.us). Two response shapes,
    /// preserved from the original endpoint: <c>{ Message, Updated }</c> when nothing needs
    /// geocoding, otherwise <c>{ Message, UniqueZips, Updated, Failed }</c>.
    /// </summary>
    Task<object> GeocodeByZipAsync(CancellationToken cancellationToken);
}

public sealed record ElevatorCacheRefreshResult(
    int OdsTotal, int Inserted, int Updated, int Geocoded, int GeoFailed, double ElapsedSeconds);

public sealed record ElevatorGeocodeStarted(string Message, int ElevatorsToGeocode, double EstimatedMinutes);

public sealed record ElevatorGeocodeStatus(int Total, int WithCoordinates, int MissingCoordinates, double PercentComplete);
