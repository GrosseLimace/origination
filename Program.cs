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
builder.Services.AddScoped<IDataService, MockDataService>();
builder.Services.AddScoped<ToastService>();
builder.Services.AddApexCharts();

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
