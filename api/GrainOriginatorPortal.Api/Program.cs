using System.Text.Json.Serialization;
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
    });

// Enable OpenAPI/Swagger for API documentation (available at /openapi/v1.json)
builder.Services.AddOpenApi();

// Register the data service as a Singleton to maintain state across requests.
// MockDataService provides in-memory sample data for development/demo purposes.
// In production, this would be replaced with a database-backed implementation.
builder.Services.AddSingleton<IDataService, MockDataService>();

// Configure CORS to allow requests from the Angular development server.
// This is required because the Angular app runs on a different port (4200)
// than the API (5000), which would otherwise be blocked by browser security.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins("http://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// =============================================================================
// Middleware Pipeline Configuration
// =============================================================================

// Enable OpenAPI endpoint in development for API testing/documentation
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Redirect HTTP requests to HTTPS for security
app.UseHttpsRedirection();

// Apply CORS policy to allow Angular frontend requests
app.UseCors("AllowAngular");

// Map controller routes (e.g., /api/customers, /api/contracts, etc.)
app.MapControllers();

// Start the application
app.Run();

// Git changes