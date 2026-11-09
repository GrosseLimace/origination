// Microsoft namespaces
using Microsoft.Extensions.Http.Resilience;

// Polly namespaces
using Polly;
using Polly.Timeout;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Platform.Geocode;

public static class GeocodeServiceCollectionExtensions
{
    /// <summary>
    /// Address geocoding through Nominatim: the service and its "nominatim" HttpClient. Needs
    /// <c>CorrelationIdOutboundHandler</c>, which AddPlatform registers.
    /// </summary>
    public static IServiceCollection AddGeocode(this IServiceCollection services)
    {
        // Singleton so the Nominatim rate-limiter + last-call timestamp are shared across requests.
        services.AddSingleton<IGeocodeService, GeocodeService>();

        // Nominatim geocoding client — BaseAddress set here so the service uses relative URLs.
        // Resilience pipeline: retry with exponential backoff + circuit breaker per §6.
        // CorrelationIdOutboundHandler propagates X-Correlation-Id to all outbound calls (§8).
        services.AddHttpClient("nominatim", client =>
        {
            client.BaseAddress = new Uri("https://nominatim.openstreetmap.org/");
            client.DefaultRequestHeaders.Add("User-Agent", "GrainOriginatorPortal/1.0");
            client.Timeout = TimeSpan.FromSeconds(10);
        })
        .AddHttpMessageHandler<CorrelationIdOutboundHandler>()
        .AddResilienceHandler("nominatim", pipeline =>
        {
            // Retry: up to 3 attempts with exponential backoff + jitter (§6.2)
            pipeline.AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = 3,
                Delay = TimeSpan.FromMilliseconds(500),
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                MaxDelay = TimeSpan.FromSeconds(30),
                // Only retry on transient network/timeout failures — not 4xx
                ShouldHandle = args => ValueTask.FromResult(
                    args.Outcome.Exception is HttpRequestException ||
                    args.Outcome.Exception is TaskCanceledException ||
                    args.Outcome.Exception is TimeoutRejectedException)
            });

            // Circuit breaker: opens after 50% failure rate over 5+ requests in 30s window (§6.3)
            pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
            {
                FailureRatio = 0.5,
                SamplingDuration = TimeSpan.FromSeconds(30),
                MinimumThroughput = 5,
                BreakDuration = TimeSpan.FromSeconds(30)
            });

            // Per ATTEMPT. Innermost so each retry gets its own clock. Sized to the slowest legitimate request
            // we have measured - a 500-row contract page with pricing lines at ~12s, or a customerIds crop-year
            // page at ~8-20s - with headroom, and well under the server's own 30s HC0045 limit so we give up
            // at the same point it does rather than after it.
            pipeline.AddTimeout(TimeSpan.FromSeconds(30));
        });

        return services;
    }
}
