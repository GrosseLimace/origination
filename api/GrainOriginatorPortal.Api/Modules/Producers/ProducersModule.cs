// Project namespaces
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.FdCic;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.TDisc;
using GrainOriginatorPortal.Api.Modules.Producers.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Producers;

namespace GrainOriginatorPortal.Api.Modules.Producers;

/// <summary>
/// The Producers module: planting intentions, producer details, stored grain, DP contracts, the Planting
/// Dashboard's estimates, and the field plan with its 45Z calculators and documents. Its controllers are
/// found by MVC; this registers what they depend on. The 45Z documents are filed through the Platform's Doc
/// Store client (<c>AddDocStore</c>).
/// </summary>
public static class ProducersModule
{
    public static IServiceCollection AddProducersModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddProducersInfrastructure(configuration);

        services.AddScoped<IPlantingIntentionService, PlantingIntentionService>();
        services.AddScoped<IProducerDetailsService, ProducerDetailsService>();
        services.AddScoped<IStoredGrainService, StoredGrainService>();
        services.AddScoped<IDpContractService, DpContractService>();
        services.AddScoped<IDashboardService, DashboardService>();

        AddFieldPlan(services, configuration);
        return services;
    }

    /// <summary>
    /// Loads and gates the 45Z FD-CIC and T-DISC packs, so a version that fails its Excel test cases is logged
    /// at deploy time instead of on the first scoring request. A failing version doesn't stop the app.
    /// </summary>
    public static void LoadFieldPlanPacks(this IServiceProvider services)
    {
        services.GetRequiredService<IFdCicService>();
        services.GetRequiredService<ITDiscService>();
    }

    private static void AddFieldPlan(IServiceCollection services, IConfiguration configuration)
    {
        // 45Z FD-CIC calculator. Singleton: the embedded USDA packs are loaded and checked against their
        // Excel test cases once, at startup (see LoadFieldPlanPacks). Each method handles one set of USDA
        // workbook formulas.
        services.AddSingleton(FdCicSettings.From(configuration));
        services.AddSingleton<IFdCicMethod, FdCicMethodV1>();
        services.AddSingleton<IFdCicService, FdCicService>();
        services.AddSingleton<ITDiscService, TDiscService>();
        services.AddScoped<IProducerSplitService, ProducerSplitService>();
        services.AddScoped<IFieldTicketService, FieldTicketService>();
        services.AddScoped<IFieldPlanService, FieldPlanService>();
        services.AddScoped<IFieldPlanDocumentService, FieldPlanDocumentService>();
    }
}
