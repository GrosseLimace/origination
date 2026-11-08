// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.BidSheet;

/// <summary>
/// The Bid Sheet module's repositories: bid sheets and their locations, and the BarChart catalog and ingest.
/// <c>AddBidSheetModule</c> in the Api calls this.
/// </summary>
public static class BidSheetInfrastructure
{
    public static IServiceCollection AddBidSheetInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<IBidSheetRepository, BidSheetRepository>();
        services.AddScoped<IBarchartCatalogRepository, BarchartCatalogRepository>();
        services.AddScoped<IBarchartIngestRepository, BarchartIngestRepository>();
        return services;
    }
}
