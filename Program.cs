/*
 * ============================================================================
 * GRAIN ORIGINATOR PORTAL - Main Application Entry Point
 * ============================================================================
 *
 * This is a Blazor Server application for grain originators to manage
 * customer relationships, contracts, deliveries, and business insights.
 *
 * CURRENT STATE: Development/Demo with Mock Data
 *
 * TODO: Before production deployment:
 *
 * 1. DATABASE CONNECTION
 *    - Add Entity Framework Core packages:
 *      dotnet add package Microsoft.EntityFrameworkCore.SqlServer
 *      dotnet add package Microsoft.EntityFrameworkCore.Tools
 *    - Create ApplicationDbContext
 *    - Configure connection string in appsettings.json
 *    - Replace MockDataService with EFDataService
 *
 * 2. AUTHENTICATION
 *    - Add Microsoft.AspNetCore.Identity or Azure AD
 *    - Protect routes with [Authorize] attribute
 *    - Add user context to notes and audit fields
 *
 * 3. API INTEGRATION (if using external systems)
 *    - Add HttpClient factory for external APIs
 *    - Implement retry policies with Polly
 *    - Add API key management
 *
 * 4. CONFIGURATION
 *    - Move magic numbers to appsettings.json
 *    - Add environment-specific configurations
 *    - Set up logging (Serilog recommended)
 *
 * 5. PERFORMANCE
 *    - Add response caching where appropriate
 *    - Implement pagination for large data sets
 *    - Consider SignalR for real-time updates
 *
 * ============================================================================
 */

using GrainOriginatorPortal.Services;
using GrainOriginatorPortal.Components;
using ApexCharts;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

// Register our custom services
builder.Services.AddScoped<ThemeService>();
builder.Services.AddScoped<AppState>();
builder.Services.AddScoped<ToastService>();
builder.Services.AddApexCharts();

// TODO: Data Service Registration
// Currently using MockDataService with static demo data.
// For production, replace with one of the following:
//
// Option 1 - Entity Framework:
// builder.Services.AddDbContext<ApplicationDbContext>(options =>
//     options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));
// builder.Services.AddScoped<IDataService, EFDataService>();
//
// Option 2 - REST API:
// builder.Services.AddHttpClient<IDataService, ApiDataService>(client =>
//     client.BaseAddress = new Uri(builder.Configuration["ApiBaseUrl"]));
builder.Services.AddScoped<IDataService, MockDataService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
