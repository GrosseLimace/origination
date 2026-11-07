// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Producers.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.Producers;

/// <summary>The Producers module's repositories and CTRM readers. <c>AddProducersModule</c> in the Api calls this.</summary>
public static class ProducersInfrastructure
{
    public static IServiceCollection AddProducersInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<IPlantingIntentionRepository, PlantingIntentionRepository>();
        services.AddScoped<IProducerDetailsRepository, ProducerDetailsRepository>();
        services.AddScoped<IStoredGrainRepository, StoredGrainRepository>();
        services.AddScoped<IDpContractRepository, DpContractRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();

        // Field plan: its fields (CTRM splits) and the CTRM tickets counted against them.
        services.AddScoped<IFieldPlanRepository, FieldPlanRepository>();
        services.AddScoped<IFieldTicketReader, CtrmFieldTicketReader>();
        AddCtrmSplits(services, configuration);
        return services;
    }

    /// <summary>
    /// A producer's CTRM splits (field-plan fields) come from <c>Ctrm:SplitsSource</c>: <c>manual</c> (the
    /// go-live default: typed by hand, no list) or <c>sample</c> (local demos) until the CTRM splits query is confirmed, then <c>ctrm</c>. Asking for <c>ctrm</c> before
    /// <see cref="CtrmQueries.SplitsQueryConfirmed"/> stops startup, so a guessed query is never sent.
    /// </summary>
    public static void AddCtrmSplits(IServiceCollection services, IConfiguration configuration)
    {
        // SPLITS-GRAPHQL: 'manual' (typed by originators) is the go-live default until CTRM's splits query is ready.
        var source = configuration["Ctrm:SplitsSource"]?.Trim().ToLowerInvariant() ?? "manual";
        switch (source)
        {
            case "" or "manual":
                services.AddSingleton<ICtrmSplitReader, ManualCtrmSplitReader>();
                break;
            case "sample":
                services.AddSingleton<ICtrmSplitReader, SampleCtrmSplitReader>();
                break;
            case "ctrm" when CtrmQueries.SplitsQueryConfirmed:
                services.AddSingleton<ICtrmSplitReader, CtrmSplitReader>();
                break;
            case "ctrm":
                throw new InvalidOperationException(
                    "Ctrm:SplitsSource is 'ctrm', but the CTRM splits query is still a placeholder (CtrmQueries.SplitsQueryConfirmed). Use 'manual' until it is confirmed.");
            default:
                throw new InvalidOperationException($"Ctrm:SplitsSource must be 'manual', 'sample' or 'ctrm', not '{source}'.");
        }
        services.AddScoped<ICtrmSplitRepository, CtrmSplitRepository>();
    }
}
