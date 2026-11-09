// Microsoft namespaces
using Microsoft.Extensions.Http.Resilience;

// Polly namespaces
using Polly;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Infrastructure.Platform.Ctrm;

namespace GrainOriginatorPortal.Api.Platform.Ctrm;

public static class CtrmServiceCollectionExtensions
{
    /// <summary>
    /// The one CTRM GraphQL client the Customers, Contracts and Producers readers share, and its "ctrm" HttpClient.
    /// Needs <c>CorrelationIdOutboundHandler</c>, which AddPlatform registers.
    /// </summary>
    public static IServiceCollection AddCtrmClient(this IServiceCollection services, IConfiguration configuration)
    {
        // CTRM GraphQL client (DB2Connector.GraphQL spike) — singleton so the cached token is shared.
        // With Ctrm:UseManagedIdentity on App Service, tokens come from the managed identity (app roles on
        // scoular-graphql-api), the same way the Graph directory client does it; otherwise on App Service it is
        // client credentials with the secret from Key Vault as 'Ctrm--ClientSecret' (Key Vault maps '--' to ':').
        // A laptop calls CTRM as the developer's own 'az login' (see CtrmCredentialFactory) and never reads
        // the secret. When nothing usable is configured the credential stays null and the client reports
        // NotConfigured. That is a FAILED read, not a fallback: with Ctrm:Source=ctrm the contract and ticket
        // screens show a load error. Rolling back to ODS is the setting Ctrm__Source=ods.
        services.AddSingleton<ICtrmGraphQlClient>(sp =>
        {
            var config = sp.GetRequiredService<IConfiguration>();
            var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
            var (ctrmCredential, ctrmCredentialKind) = CtrmCredentialFactory.Create(config, isAppService);

            // Logged once so a deployed environment shows which identity it is calling CTRM as.
            sp.GetRequiredService<ILogger<CtrmGraphQlClient>>()
                .LogInformation("CTRM GraphQL credential: {CtrmCredentialKind}", ctrmCredentialKind);

            return new CtrmGraphQlClient(
                ctrmCredential,
                sp.GetRequiredService<IHttpClientFactory>(),
                config,
                sp.GetRequiredService<ILogger<CtrmGraphQlClient>>());
        });

        // CTRM GraphQL: BaseAddress is the FULL endpoint URL (single POST target, no relative paths), so
        // it comes from config rather than being hard-coded — each environment points at its own gateway.
        // Timeout is 30s rather than 10s because a cold contract-snapshot page has been measured at ~3.4s
        // and the API is an on-prem node behind APIM, not an Azure-local service.
        services.AddHttpClient(CtrmGraphQlClient.HttpClientName, client =>
        {
            var uri = configuration.GetValue<string>("Ctrm:GraphQlUri")?.Trim();
            if (!string.IsNullOrEmpty(uri))
                client.BaseAddress = new Uri(uri);
            // The OVERALL budget for one logical call, retries included. The per-attempt limit is the AddTimeout
            // strategy in the pipeline below. These used to be one 30-second number, which meant a slow-but-fine
            // attempt was retried inside a budget it had already spent - the retries could not succeed, and the
            // producer screen saw "Timed out reaching the CTRM gateway" under load. 3 attempts x 45s + backoff.
            client.Timeout = TimeSpan.FromSeconds(150);
        })
        .AddHttpMessageHandler<CorrelationIdOutboundHandler>()
        .AddResilienceHandler("ctrm", pipeline =>
        {
            pipeline.AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = 2,
                Delay = TimeSpan.FromMilliseconds(500),
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
                MaxDelay = TimeSpan.FromSeconds(10),
                // Exceptions only — never status codes. This API answers HTTP 500 for caller-input
                // validation failures, so retrying on status would triple the cost of a bad query and
                // still fail. A 401 likewise has to reach CtrmGraphQlClient unretried to be reported
                // as Unauthorized.
                ShouldHandle = args => ValueTask.FromResult(
                    args.Outcome.Exception is HttpRequestException ||
                    args.Outcome.Exception is TaskCanceledException)
            });

            pipeline.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
            {
                FailureRatio = 0.5,
                SamplingDuration = TimeSpan.FromSeconds(30),
                MinimumThroughput = 5,
                BreakDuration = TimeSpan.FromSeconds(30)
            });

            // PER-ATTEMPT limit, innermost so it wraps the individual request rather than the retry sequence.
            // There was none: the comment on client.Timeout above claimed one but nothing enforced it, so a single
            // hung attempt could hold a request for the whole 110-second client budget.
            //
            // 45 seconds, well clear of the server's own 30-second limit, on purpose. The server answers its
            // timeout as a GraphQL error (HC0045, HTTP 400) that CtrmServerTimeoutRetry handles deliberately,
            // and the circuit breaker above ignores a 400 by design. But that answer does not arrive AT 30
            // seconds: measured 2026-09-29 it landed at 31.5 s on the PROD gateway and 36 s on the nonprod one.
            // At the previous 35 s this timeout fired first on the slow days, which turned every server-side
            // timeout into a TimeoutRejectedException - which the breaker DOES count. One trade-unit walk of
            // sixteen batches on a cold gateway tripped it, and for the next 30 s every producer click got
            // EgressBlocked although the gateway was answering single reads in under a second. 45 s lets the
            // HC0045 through as the 400 it is, with its correlation id, and leaves the breaker for the real
            // outage it exists for: connection failures, 5xx, and an attempt with no answer at all in 45 s.
            //
            // TimeoutRejectedException is deliberately NOT in the retry ShouldHandle above: a hung attempt should
            // fail fast to EgressBlocked, which names the remediation, rather than being retried twice more.
            pipeline.AddTimeout(TimeSpan.FromSeconds(45));
        });

        return services;
    }
}
