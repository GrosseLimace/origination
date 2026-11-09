// Project namespaces
using GrainOriginatorPortal.Api.Modules.Contracts.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts;
using GrainOriginatorPortal.Api.Platform.Diagnostics;

namespace GrainOriginatorPortal.Api.Modules.Contracts;

/// <summary>
/// The Contracts module: contracts, pricing lines and delivery tickets, read from ODS or CTRM as
/// <c>Ctrm:Source</c> says, and the service that keeps the trade-unit-wide CTRM caches warm. Its controllers
/// are found by MVC; this registers what they depend on. It also answers the Customers module's open-activity
/// question (<c>ICustomerActivitySource</c>).
/// </summary>
public static class ContractsModule
{
    public static IServiceCollection AddContractsModule(this IServiceCollection services)
    {
        services.AddContractsInfrastructure();

        services.AddScoped<IContractService, ContractService>();
        services.AddScoped<ITicketService, TicketService>();
        services.AddScoped<IContractLookup, ContractLookup>();
        // The CTRM probes the diagnostics page runs; Platform's diagnostics controller declares what it needs.
        services.AddScoped<ICtrmDiagnosticsService, CtrmDiagnosticsService>();

        // Keeps the trade-unit-wide CTRM caches warm for recently-used producer sets, so Build-a-List prompts
        // never pay for a cache that expired between uses. No-op unless Ctrm:Source is 'ctrm'.
        // The keep-warm cycle reads CTRM through a small seam so its per-set failure isolation is testable;
        // production wires the one adapter over the real readers.
        services.AddSingleton<ICtrmWarmReads, CtrmWarmReads>();
        services.AddHostedService<CtrmKeepWarmService>();
        return services;
    }
}
