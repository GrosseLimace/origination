// System namespaces
using System.Threading.RateLimiting;

// Microsoft namespaces
using Microsoft.AspNetCore.RateLimiting;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Platform.Ctrm;
using GrainOriginatorPortal.Api.Platform.Diagnostics;
using GrainOriginatorPortal.Api.Platform.DocStore;
using GrainOriginatorPortal.Api.Platform.Exceptions;
using GrainOriginatorPortal.Api.Platform.Geocode;
using GrainOriginatorPortal.Api.Platform.Identity;
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Api.Platform.Preferences;
using GrainOriginatorPortal.Api.Platform.ReferenceData;
using GrainOriginatorPortal.Api.Platform.Telemetry;
using GrainOriginatorPortal.Infrastructure.Platform;
using GrainOriginatorPortal.Infrastructure.Platform.Json;

namespace GrainOriginatorPortal.Api.Platform;

/// <summary>
/// What every module builds on: the web API itself (errors, controllers and the JSON contract, CORS, rate limiting,
/// compression and health checks), sign-in and permissions, the DbContexts and Platform's repositories, the shared
/// clients (CTRM, Graph, Doc Store and geocoding), usage telemetry, preferences, reference data and diagnostics.
/// Program.cs calls <see cref="AddPlatform"/> before any module.
/// </summary>
public static class PlatformModule
{
    public static IServiceCollection AddPlatform(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        // Register global exception handler — returns ApiErrorResponse per error-handling-standards.md §2
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails();

        // Entra ID bearer tokens on every request, the authorization services, and the signed-in user's context.
        services.AddSignIn(configuration);

        // Permissions: roles from the token, grants from the database. [RequirePermission] checks
        // them through one policy per catalog permission, each of which carries the default policy's
        // requirements as well.
        services.AddAccess(configuration);

        // Doc Store: documents filed by category. Each feature names its own category; this is how the app reaches it.
        services.AddDocStore(configuration, environment);

        services.AddUsageTelemetry(configuration);

        // IHttpContextAccessor, for the services that need the current request (trace id propagation to service-layer logs).
        services.AddHttpContextAccessor();

        AddControllersWithTheJsonContract(services);
        UseTheErrorEnvelopeForModelValidation(services);

        // Enable OpenAPI/Swagger for API documentation (available at /openapi/v1.json)
        services.AddOpenApi();

        // Bounded in-memory cache for geocode results (M-12: replaces unbounded ConcurrentDictionary)
        services.AddMemoryCache(options => options.SizeLimit = 5000);

        // Entity Framework Core DbContexts (ODS, Application, Entitlements) and Platform's repositories. Connection
        // strings come from appsettings / Azure App Settings; auth via DefaultAzureCredential; retry logic handles
        // transient Azure SQL failures.
        services.AddPlatformInfrastructure(configuration, environment.IsDevelopment());

        services.AddPreferences();
        services.AddScoped<ICommodityService, CommodityService>();
        // Admin diagnostics: the services the DiagnosticsController delegates to (schema, commodity seed, elevator
        // cache, usage-rollup backfill, app-access members). The CTRM probes come from the Contracts module.
        services.AddDiagnosticsServices();

        // Outbound clients. CorrelationIdOutboundHandler propagates X-Correlation-Id to all outbound calls (§8);
        // the Engagement module and Doc Store use it too.
        services.AddTransient<CorrelationIdOutboundHandler>();
        services.AddGeocode();
        services.AddDirectory();
        services.AddCtrmClient(configuration);

        AddCorsForTheSpa(services, configuration);
        AddRateLimiting(services);

        // RESPONSE COMPRESSION — gzip JSON responses (5-10x smaller over the wire).
        // Especially benefits large payloads like GET /api/customers.
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
        });

        // HEALTH CHECKS (§8 — /health/live and /health/ready)
        services.AddHealthChecks()
            .AddDbContextCheck<OriginationDbContext>("origination_db", tags: ["ready"])
            .AddDbContextCheck<ApplicationDbContext>("application_db", tags: ["ready"]);

        return services;
    }

    /// <summary>Controllers for the REST API, with the JSON contract every endpoint shares.</summary>
    private static void AddControllersWithTheJsonContract(IServiceCollection services)
    {
        // Configure JSON to serialize enums as strings instead of numbers
        services.AddControllers()
            .AddJsonOptions(options =>
            {
                options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
                // All persisted DateTimes are UTC (DateTime.UtcNow on write). EF Core reads them back as
                // Kind=Unspecified, which makes the default writer emit ISO strings without a 'Z' suffix —
                // browsers then parse those as local time and shift the displayed clock by the user's TZ
                // offset. These converters normalize every DateTime to UTC on the wire.
                options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
                options.JsonSerializerOptions.Converters.Add(new NullableUtcDateTimeJsonConverter());
                // Ensure all properties are included, even null values
                options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
                // Reject unknown fields in request bodies — security-guide.md §4.1 serialization hardening.
                // Prevents mass assignment and forces clients to send only known properties.
                options.JsonSerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
            });
    }

    /// <summary>
    /// Make [ApiController]'s automatic model-validation failures use the app's own error envelope.
    /// </summary>
    /// <remarks>
    /// Every controller here carries [ApiController], which short-circuits a data-annotation failure
    /// into the framework's RFC7807 ValidationProblemDetails *before* GlobalExceptionHandler or our own
    /// ValidationException ever run. That is the single most common validation failure across the whole
    /// write surface, and it was the one shape the Angular client can't read — so the identical
    /// conceptual error produced two different bodies depending on whether it was caught by an
    /// annotation or thrown by hand. One factory, and every controller agrees.
    /// </remarks>
    private static void UseTheErrorEnvelopeForModelValidation(IServiceCollection services)
    {
        services.Configure<ApiBehaviorOptions>(options =>
        {
            options.InvalidModelStateResponseFactory = context =>
            {
                var http = context.HttpContext;
                var traceId = http.Items[CorrelationIdMiddleware.ItemsKey]?.ToString() ?? http.TraceIdentifier;

                // Field-level detail, same shape a thrown ValidationException produces.
                var details = context.ModelState
                    .Where(kvp => kvp.Value?.Errors.Count > 0)
                    .SelectMany(kvp => kvp.Value!.Errors.Select(e => new ApiErrorDetail
                    {
                        Field = kvp.Key,
                        // ErrorMessage is empty when the failure came from a binding/parse exception;
                        // don't leak the exception text to the caller, which may name internal types.
                        Message = string.IsNullOrWhiteSpace(e.ErrorMessage)
                            ? "The value provided is not valid for this field."
                            : e.ErrorMessage,
                        Code = "VALIDATION_INVALID_FIELD",
                    }))
                    .ToList();

                http.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("GrainOriginatorPortal.Api.ModelValidation")
                    .LogWarning(
                        "Validation error [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {FieldCount} field(s) failed on {Method} {Path}",
                        traceId, "VALIDATION_ERROR", "Validation", details.Count,
                        http.Request.Method, http.Request.Path.Value);

                return new BadRequestObjectResult(new ApiErrorResponse
                {
                    Error = new ApiErrorBody
                    {
                        Code = "VALIDATION_ERROR",
                        Message = "One or more fields failed validation.",
                        Details = details,
                        TraceId = traceId,
                        Timestamp = DateTime.UtcNow.ToString("O"),
                        Instance = http.Request.Path.Value,
                    }
                });
            };
        });
    }

    /// <summary>
    /// Configure CORS — allowed origins come from configuration so they can be overridden
    /// per environment via Azure App Service settings without code changes.
    /// </summary>
    private static void AddCorsForTheSpa(IServiceCollection services, IConfiguration configuration)
    {
        services.AddCors(options =>
        {
            options.AddPolicy("AllowAngular", policy =>
            {
                var origins = configuration.GetSection("AllowedOrigins").Get<string[]>()
                    ?? new[] { "http://localhost:4200" };
                policy.WithOrigins(origins)
                      .WithHeaders("Content-Type", "Authorization")
                      .WithMethods("GET", "POST", "PUT", "DELETE");
            });
        });
    }

    /// <summary>
    /// RATE LIMITING — security-guide.md §4.1 (CWE-770)
    /// Fixed-window limiter: 1000 requests per minute per authenticated user (or IP for anonymous).
    /// </summary>
    private static void AddRateLimiting(IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                RateLimitPartition.GetFixedWindowLimiter(
                    ctx.User?.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 1000,
                        Window = TimeSpan.FromMinutes(1)
                    }));

            // The limiter writes its own rejection, so it never passes through GlobalExceptionHandler —
            // which left the app's only real 429 with an empty body and no Retry-After, and made the
            // handler's own 429 branch dead code. Emit the standard error envelope here instead.
            options.OnRejected = async (context, cancellationToken) =>
            {
                var http = context.HttpContext;
                var traceId = http.Items[CorrelationIdMiddleware.ItemsKey]?.ToString() ?? http.TraceIdentifier;

                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var window)
                    ? (int)window.TotalSeconds
                    : 30;
                http.Response.Headers.RetryAfter = retryAfter.ToString();

                http.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("GrainOriginatorPortal.Api.RateLimiting")
                    .LogWarning(
                        "Rate limit exceeded [{TraceId}] [{ErrorCode}] [{ErrorCategory}]: {Method} {Path} → 429",
                        traceId, "RATE_LIMIT_EXCEEDED", "Security", http.Request.Method, http.Request.Path.Value);

                await http.Response.WriteAsJsonAsync(new ApiErrorResponse
                {
                    Error = new ApiErrorBody
                    {
                        Code = "RATE_LIMIT_EXCEEDED",
                        Message = "Too many requests. Please wait a moment and try again.",
                        TraceId = traceId,
                        Timestamp = DateTime.UtcNow.ToString("O"),
                        Instance = http.Request.Path.Value
                    }
                }, cancellationToken);
            };
        });
    }
}
