// Azure namespaces
using Azure.Extensions.AspNetCore.Configuration.Secrets;
using Azure.Identity;

// Microsoft namespaces
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

// Project namespaces
using GrainOriginatorPortal.Api.Modules.BidSheet;
using GrainOriginatorPortal.Api.Modules.Contracts;
using GrainOriginatorPortal.Api.Modules.Customers;
using GrainOriginatorPortal.Api.Modules.Engagement;
using GrainOriginatorPortal.Api.Modules.Lists;
using GrainOriginatorPortal.Api.Modules.Producers;
using GrainOriginatorPortal.Api.Modules.UsageAnalytics;
using GrainOriginatorPortal.Api.Platform;
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Api.Platform.Version;
using GrainOriginatorPortal.Api.Platform.WhatsNew.Controllers;

var builder = WebApplication.CreateBuilder(args);

// Suppress the "Server: Kestrel" response header so we don't advertise the server
// technology to clients (avoids unnecessary info disclosure / fingerprinting).
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

// =============================================================================
// KEY VAULT — load secrets into configuration before anything else reads it.
// On App Service, use ManagedIdentityCredential directly (avoids DefaultAzureCredential
// cycling through ~8 providers, which adds ~60-120s to cold start on Linux).
// Locally, use DefaultAzureCredential without ManagedIdentity (avoids IMDS timeout).
// KeyVaultUri is pre-configured as an App Setting in all deployed environments.
// =============================================================================
var keyVaultUri = builder.Configuration["KeyVaultUri"];
if (!string.IsNullOrEmpty(keyVaultUri))
{
    var isAppService = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"));
    Azure.Core.TokenCredential kvCredential = isAppService
        ? new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned)
        : new DefaultAzureCredential(new DefaultAzureCredentialOptions
            { ExcludeManagedIdentityCredential = true });

    try
    {
        builder.Configuration.AddAzureKeyVault(new Uri(keyVaultUri), kvCredential);
    }
    catch (Exception ex) when (!isAppService)
    {
        // On App Service, Key Vault is always accessible via Managed Identity — don't swallow.
        // Locally, a developer may not yet have Key Vault access (pending Developer Access
        // package approval). Warn and continue — no secrets are required to run locally.
        Console.Error.WriteLine($"[WARNING] Key Vault unavailable locally ({ex.GetType().Name}: {ex.Message}). " +
            "Request the Developer Access package at myaccess.microsoft.com if you need secrets.");
    }
}

// =============================================================================
// Development: Override the ActiveDirectoryDefault SQL auth provider to use
// AzureCliCredential directly. DefaultAzureCredential probes the Azure IMDS
// endpoint (169.254.169.254) for ManagedIdentity, which times out (~1 s) in
// local dev. AzureCliCredential skips all of that — it just calls
// `az account get-access-token` and caches the result.
// =============================================================================
if (builder.Environment.IsDevelopment())
{
    SqlAuthenticationProvider.SetProvider(
        SqlAuthenticationMethod.ActiveDirectoryDefault,
        new AzureCliSqlAuthProvider());
}

// =============================================================================
// Service Configuration
// Platform first: the web API itself, sign-in and permissions, the DbContexts, the shared clients and
// services every module builds on (Platform/PlatformModule.cs). Then each module registers its own
// services and, through its Infrastructure counterpart, its repositories.
// =============================================================================
builder.Services
    .AddPlatform(builder.Configuration, builder.Environment)
    .AddCustomersModule()
    .AddContractsModule()   // CTRM/ODS repository switches live here; they read Ctrm:Source on every call
    .AddEngagementModule()
    .AddProducersModule(builder.Configuration)
    .AddListsModule()
    .AddBidSheetModule()
    .AddUsageAnalyticsModule();

var app = builder.Build();

// Record which build is serving, so App Insights can tie a request or an error back to an exact
// commit and workflow run. Stamped by CI via Directory.Build.props; reads "local" on a dev box.
app.Logger.LogInformation(
    "Origination API starting. Release {ReleaseVersion}, build {CommitSha} (#{BuildNumber}), environment {Environment}.",
    WhatsNewController.Releases.Value.FirstOrDefault()?.Version ?? "none",
    BuildInfo.CommitSha,
    BuildInfo.BuildNumber,
    app.Environment.EnvironmentName);

// Load and gate the 45Z FD-CIC and T-DISC packs now, so a version that fails its Excel test cases is logged at
// deploy time instead of on the first scoring request. A failing version doesn't stop the app.
app.Services.LoadFieldPlanPacks();

// =============================================================================
// Development: Warm up all three DB connections in parallel at startup.
// Token acquisition and connection pool setup happen here (hidden in startup time)
// rather than on the first user request, which would feel slow.
// =============================================================================
if (app.Environment.IsDevelopment())
{
    _ = Task.Run(async () =>
    {
        try
        {
            using var scope = app.Services.CreateScope();
            var odsDb = scope.ServiceProvider.GetRequiredService<OriginationDbContext>();
            var appDb = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var entDb = scope.ServiceProvider.GetRequiredService<TradeUnitPreferencesDbContext>();
            await Task.WhenAll(
                odsDb.Database.OpenConnectionAsync(),
                appDb.Database.OpenConnectionAsync(),
                entDb.Database.OpenConnectionAsync()
            );
            app.Logger.LogInformation("DB connections warmed up successfully.");

            // No commodity sync runs here, and there is no longer one to run. dbo.Commodities is
            // hand-curated (Code/Name/Category plus Tier1/Tier2/Tier3/BaseUOM, none of which a scan of
            // ODS contracts could supply), so the repository's ODS-scanning SyncAsync was never wired to
            // anything and has been removed. The Dev-only POST /api/diagnostics/commodities/seed endpoint
            // remains for a one-time backfill; it has always carried its own query rather than calling
            // that method.
        }
        catch (Exception ex)
        {
            app.Logger.LogWarning(ex, "DB warm-up failed — first request will be slower.");
        }
    });
}

// =============================================================================
// Database Initialization (Development Only)
// =============================================================================

// NOTE: ApplicationDbContext migrations are applied via the deployment pipeline, not at startup.
// Run manually: dotnet ef database update --project api/GrainOriginatorPortal.Api

// =============================================================================
// Middleware Pipeline Configuration
// =============================================================================

// Enable OpenAPI endpoint in development for API testing/documentation
// RequireAuthorization ensures a valid Azure AD token is needed to access the spec
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().RequireAuthorization();
}

// Response compression — gzip large JSON payloads. Must be before any middleware that writes response bodies.
app.UseResponseCompression();

// Global exception handling — must be first in the middleware pipeline
app.UseExceptionHandler();

// Security response headers — X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.
// security-guide.md §4.1
app.UseMiddleware<SecurityHeadersMiddleware>();

// Correlation ID — generate/propagate X-Correlation-Id on every request (§8)
app.UseMiddleware<CorrelationIdMiddleware>();

// Apply CORS policy to allow Angular frontend requests
// MUST come before UseHttpsRedirection to handle preflight requests correctly
app.UseCors("AllowAngular");

// Rate limiting — reject excessive requests before they hit auth/controllers (§4.1 CWE-770)
app.UseRateLimiter();

// Redirect HTTP requests to HTTPS for security
app.UseHttpsRedirection();

// Serve Angular static assets (CSS, JS, images) from wwwroot
// Must come before UseAuthentication so static files don't require a token
app.UseStaticFiles();

// Authentication + authorization — must come after CORS and before MapControllers
app.UseAuthentication();
app.UseAuthorization();

// Request context — sets ServiceName, Operation, TraceId, UserId in log scope.
// MUST run AFTER UseAuthentication() so context.User is populated with JWT claims
// and UserId resolves to the actual user (not "anonymous").
app.UseMiddleware<RequestContextMiddleware>();

// Security audit logging — logs 401 and 403 outcomes per security-guide.md §8.1.
// Must run after UseAuthorization so the response status code is already finalized.
app.UseMiddleware<SecurityAuditMiddleware>();

// Usage tracking — records every authenticated API request for the usage dashboard.
// Runs after auth so UserId is resolved. Non-blocking: writes to a bounded channel.
app.UseMiddleware<UsageTrackingMiddleware>();

// Reports which source (ODS or CTRM) actually served each response's contract and ticket data, as
// X-Data-Source* headers visible in the browser's Network tab. The two sources are mapped to look
// identical in the response body, so without this there is no way to confirm from the client which
// one you are looking at. Non-production only — diagnostic detail with no place in a prod response.
if (!app.Environment.IsProduction())
    app.UseMiddleware<CtrmProvenanceMiddleware>();

// Map controller routes and require a valid Azure AD bearer token on every endpoint.
// Health check and OpenAPI endpoints are mapped separately and are not covered here.
app.MapControllers().RequireAuthorization();

// =============================================================================
// HEALTH CHECK ENDPOINTS (§8 — liveness + readiness probes)
// /health/live  — process is running (no dependency checks)
// /health/ready — process + DB connections are ready
// =============================================================================
app.MapHealthChecks("/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = _ => false  // exclude all checks — liveness only verifies the process is up
});

app.MapHealthChecks("/health/ready", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    ResultStatusCodes =
    {
        [HealthStatus.Healthy]   = StatusCodes.Status200OK,
        [HealthStatus.Degraded]  = StatusCodes.Status200OK,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
});

// SPA fallback — return index.html for any route not matched by a controller
// This enables Angular client-side routing (/dashboard, /build-list, etc.)
app.MapFallbackToFile("index.html");

// Start the application
app.Run();

/// <summary>
/// Replaces DefaultAzureCredential with a version that skips ManagedIdentityCredential
/// for local development. DefaultAzureCredential probes the Azure IMDS endpoint
/// (169.254.169.254) which times out ~1 s per connection on a dev workstation.
/// Excluding it lets the chain reach SharedTokenCacheCredential (which works with
/// cached az login / Visual Studio tokens) without the IMDS delay.
/// </summary>
internal sealed class AzureCliSqlAuthProvider : SqlAuthenticationProvider
{
    private static readonly DefaultAzureCredential _credential = new(
        new DefaultAzureCredentialOptions { ExcludeManagedIdentityCredential = true });
    private static readonly string[] _scopes = ["https://database.windows.net/.default"];

    public override async Task<SqlAuthenticationToken> AcquireTokenAsync(SqlAuthenticationParameters parameters)
    {
        var result = await _credential.GetTokenAsync(new Azure.Core.TokenRequestContext(_scopes));
        return new SqlAuthenticationToken(result.Token, result.ExpiresOn);
    }

    public override bool IsSupported(SqlAuthenticationMethod authenticationMethod)
        => authenticationMethod == SqlAuthenticationMethod.ActiveDirectoryDefault;
}
