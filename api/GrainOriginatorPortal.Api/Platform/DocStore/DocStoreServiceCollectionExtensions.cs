// Microsoft namespaces
using Microsoft.Extensions.Options;

// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;

namespace GrainOriginatorPortal.Api.Platform.DocStore;

public static class DocStoreServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="IDocStoreClient"/> by <c>DocStore:Mode</c>: "" = off (every call answers 503),
    /// "InMemory" = a stand-in that forgets on restart, allowed ONLY in Development so no deployed environment
    /// can appear to keep a document it didn't, "Http" = the real Doc Store through APIM (managed identity on
    /// App Service, your own 'az login' on a laptop). "Http" without BaseUrl and Scope stays off rather than
    /// failing startup.
    /// </summary>
    public static IServiceCollection AddDocStore(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.Configure<DocStoreOptions>(configuration.GetSection(DocStoreOptions.Section));
        var docStore = configuration.GetSection(DocStoreOptions.Section).Get<DocStoreOptions>() ?? new();
        if (string.Equals(docStore.Mode.Trim(), "InMemory", StringComparison.OrdinalIgnoreCase))
        {
            if (!environment.IsDevelopment())
                throw new InvalidOperationException("DocStore:Mode InMemory is for local development only.");
            services.AddSingleton<IDocStoreClient, InMemoryDocStoreClient>();
        }
        else if (string.Equals(docStore.Mode.Trim(), "Http", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(docStore.BaseUrl) && !string.IsNullOrWhiteSpace(docStore.Scope))
        {
            services.AddHttpClient(HttpDocStoreClient.HttpClientName, client =>
            {
                client.BaseAddress = new Uri(docStore.BaseUrl.Trim().TrimEnd('/') + "/");
                // A 10 MB file is about 14 MB as base64; uploads aren't retried (see HttpDocStoreClient).
                client.Timeout = TimeSpan.FromSeconds(60);
            })
            .AddHttpMessageHandler<CorrelationIdOutboundHandler>();
            services.AddSingleton<IDocStoreClient>(sp =>
                new HttpDocStoreClient(
                    HttpDocStoreClient.CreateCredential(
                        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME"))),
                    sp.GetRequiredService<IHttpClientFactory>(),
                    sp.GetRequiredService<IOptions<DocStoreOptions>>(),
                    sp.GetRequiredService<ILogger<HttpDocStoreClient>>()));
        }
        else
        {
            services.AddSingleton<IDocStoreClient, DisabledDocStoreClient>();
        }

        return services;
    }
}
