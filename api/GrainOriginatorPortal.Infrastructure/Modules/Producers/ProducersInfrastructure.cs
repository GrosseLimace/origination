// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers;

/// <summary>The Producers module's repositories. <c>AddProducersModule</c> in the Api calls this.</summary>
public static class ProducersInfrastructure
{
    public static IServiceCollection AddProducersInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<IPlantingIntentionRepository, PlantingIntentionRepository>();
        services.AddScoped<IProducerDetailsRepository, ProducerDetailsRepository>();
        services.AddScoped<IStoredGrainRepository, StoredGrainRepository>();
        services.AddScoped<IDpContractRepository, DpContractRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        return services;
    }
}
