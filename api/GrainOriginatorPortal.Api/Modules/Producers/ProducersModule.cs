// Project namespaces
using GrainOriginatorPortal.Api.Modules.Producers.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Producers;

namespace GrainOriginatorPortal.Api.Modules.Producers;

/// <summary>
/// The Producers module: planting intentions, producer details, stored grain, DP contracts and the
/// Planting Dashboard's estimates. Its controllers are found by MVC; this registers what they depend on.
/// </summary>
public static class ProducersModule
{
    public static IServiceCollection AddProducersModule(this IServiceCollection services)
    {
        services.AddProducersInfrastructure();

        services.AddScoped<IPlantingIntentionService, PlantingIntentionService>();
        services.AddScoped<IProducerDetailsService, ProducerDetailsService>();
        services.AddScoped<IStoredGrainService, StoredGrainService>();
        services.AddScoped<IDpContractService, DpContractService>();
        services.AddScoped<IDashboardService, DashboardService>();
        return services;
    }
}
