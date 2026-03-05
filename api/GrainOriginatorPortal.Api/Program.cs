using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// =============================================================================
// Service Configuration
// =============================================================================

// Add MVC controllers for REST API endpoints
// Configure JSON to serialize enums as strings instead of numbers
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        // Ensure all properties are included, even null values
        options.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never;
    });

// Enable OpenAPI/Swagger for API documentation (available at /openapi/v1.json)
builder.Services.AddOpenApi();

// Configure Azure AD authentication — validates bearer tokens issued by the Scoular tenant.
// ClientId and Audience are intentionally blank here; they are injected via Azure App Service
// environment variables (AzureAd__ClientId, AzureAd__Audience) in deployed environments.
// For local development, set them in appsettings.Development.json or user secrets.
builder.Services.AddMicrosoftIdentityWebApiAuthentication(builder.Configuration);
builder.Services.AddAuthorization();

// Configure Entity Framework Core with SQL Server and Managed Identity
// - Uses connection string from appsettings.json or Azure App Settings
// - Authentication via DefaultAzureCredential (Azure CLI locally, Managed Identity in Azure)
// - Retry logic handles transient network failures (5 attempts, 30 second max delay)
builder.Services.AddDbContext<OriginationDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");

    options.UseSqlServer(connectionString, sqlOptions =>
    {
        // Enable retry on transient failures (required for Azure SQL)
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null);

        // Set command timeout to 2 minutes for large ODS queries
        sqlOptions.CommandTimeout(120);
    });

    // Enable detailed errors in development
    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
});

// Configure ApplicationDbContext for app-owned tables in the Origination database
// (Notes, and eventually TradeUnits once that table is created)
builder.Services.AddDbContext<ApplicationDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("OriginationConnection");

    options.UseSqlServer(connectionString, sqlOptions =>
    {
        sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(30),
            errorNumbersToAdd: null);
    });

    if (builder.Environment.IsDevelopment())
    {
        options.EnableSensitiveDataLogging();
        options.EnableDetailedErrors();
    }
});

// =============================================================================
// DATA SERVICE REGISTRATION
// Currently using direct SQL connection (SqlDataService).
// When APIM is ready, follow these steps to switch:
//
//   STEP 1 - Add APIM config to appsettings.json:
//     "Apim": {
//       "BaseUrl": "https://<your-apim-instance>.azure-api.net",
//       "SubscriptionKey": "<your-subscription-key>"
//     }
//
//   STEP 2 - Register the APIM HTTP client (replace the AddScoped line below):
//     builder.Services.AddHttpClient<IDataService, ApimDataService>(client =>
//     {
//         client.BaseAddress = new Uri(builder.Configuration["Apim:BaseUrl"]!);
//         client.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", builder.Configuration["Apim:SubscriptionKey"]);
//     });
//
//   STEP 3 - Remove or comment out the DbContext registration above (no longer needed)
//
//   STEP 4 - Fill in the APIM endpoint URLs in ApimDataService.cs
// =============================================================================

// CURRENT: Direct SQL connection via Entity Framework Core
// TO SWITCH TO APIM: See instructions above
builder.Services.AddScoped<IDataService, SqlDataService>();

// OPTIONAL: Keep MockDataService for testing/comparison
// Uncomment to use mock data instead of database:
// builder.Services.AddSingleton<IDataService, MockDataService>();

// Configure CORS — allowed origins come from configuration so they can be overridden
// per environment via Azure App Service settings without code changes.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        var origins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
            ?? new[] { "http://localhost:4200" };
        policy.WithOrigins(origins)
              .WithHeaders("Content-Type", "Authorization")
              .WithMethods("GET", "POST", "PUT", "DELETE");
    });
});

var app = builder.Build();

// =============================================================================
// Database Initialization (Development Only)
// =============================================================================

// Apply pending migrations automatically in development
// NOTE: In production, migrations should be applied via deployment pipeline
// DISABLED: Only reading existing tables, not creating new ones
/*
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<OriginationDbContext>();

    try
    {
        // Apply any pending migrations
        dbContext.Database.Migrate();
        app.Logger.LogInformation("Database migrations applied successfully");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Error applying database migrations");
        // Continue startup even if migration fails (allows debugging)
    }
}
*/

// =============================================================================
// Middleware Pipeline Configuration
// =============================================================================

// Enable OpenAPI endpoint in development for API testing/documentation
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Apply CORS policy to allow Angular frontend requests
// MUST come before UseHttpsRedirection to handle preflight requests correctly
app.UseCors("AllowAngular");

// Redirect HTTP requests to HTTPS for security
app.UseHttpsRedirection();

// Add standard security response headers
app.Use(async (context, next) =>
{
    context.Response.Headers.Append("X-Content-Type-Options", "nosniff");
    context.Response.Headers.Append("X-Frame-Options", "DENY");
    context.Response.Headers.Append("X-XSS-Protection", "1; mode=block");
    context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");
    await next();
});

// Authentication and authorization middleware — must come after UseCors and UseHttpsRedirection
app.UseAuthentication();
app.UseAuthorization();

// Map controller routes (e.g., /api/customers, /api/contracts, etc.)
app.MapControllers();

// Start the application
app.Run();

// Git changes