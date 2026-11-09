// Project namespaces
using GrainOriginatorPortal.Api.Modules.BidSheet.Services;
using GrainOriginatorPortal.Infrastructure.Modules.BidSheet;

namespace GrainOriginatorPortal.Api.Modules.BidSheet;

/// <summary>
/// The Bid Sheet module: bid sheets with their locations and bids, and the BarChart bid feed behind them (the
/// picker, and the ingest the pipeline runs). Its controllers are found by MVC; this registers what they depend
/// on. A sheet shared with a Daily Recap group asks Engagement's <c>IRecapGroupMembership</c> who is in it: Bid
/// Sheet builds on Engagement, which registers it.
/// </summary>
public static class BidSheetModule
{
    public static IServiceCollection AddBidSheetModule(this IServiceCollection services)
    {
        services.AddBidSheetInfrastructure();

        services.AddScoped<IBidSheetService, BidSheetService>();
        services.AddScoped<IBarchartCatalogService, BarchartCatalogService>();
        services.AddScoped<IBarchartIngestService, BarchartIngestService>();
        return services;
    }
}
