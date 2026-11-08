// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Contracts.Repositories;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Extensions;

namespace GrainOriginatorPortal.Infrastructure.Modules.Contracts;

/// <summary>
/// The Contracts module's repositories, the switches that pick ODS or CTRM for each read, and the CTRM
/// contract and ticket readers. <c>AddContractsModule</c> in the Api calls this.
/// </summary>
public static class ContractsInfrastructure
{
    public static IServiceCollection AddContractsInfrastructure(this IServiceCollection services)
    {
        // Singleton so one date-window fetch is shared by every request and every producer, rather
        // than each scoped repository paging the window again. ICtrmGraphQlClient is registered in
        // the Api project (it needs IHttpClientFactory and a credential).
        // Live per-producer readers. Singleton so their short request-coalescing cache is shared:
        // selecting a producer triggers the contract list, the pricing lines and the pacing card, which all
        // want the same rows, so one CTRM call serves all three instead of three identical round trips.
        services.AddSingleton<CtrmContractReader>();
        services.AddSingleton<CtrmTicketReader>();
        services.AddSingleton<CtrmWarmRegistry>();

        // Tickets follow the same switch pattern as contracts. The CTRM ticket repository still needs
        // the ODS one — for the ticket-key index and the storage gate, neither of which CTRM can supply.
        services.AddScoped<TicketRepository>();
        services.AddScoped<CtrmTicketRepository>();
        services.AddScoped<ITicketRepository, TicketRepositorySwitch>();

        // Contracts resolve through a switch that picks ODS or CTRM per call from Ctrm:Source.
        // Both concrete repositories are registered because the switch holds one of each, and the
        // CTRM one delegates the reads it cannot serve (pricing lines by contract, by source id)
        // straight to the ODS one. Default is ODS — see ContractRepositorySwitch.
        services.AddScoped<ContractRepository>();
        services.AddScoped<CtrmContractRepository>();
        services.AddScoped<IContractRepository, ContractRepositorySwitch>();

        // Which trade units a producer has open contracts or unapplied tickets in, for the Customers module.
        services.AddScoped<ICustomerActivitySource, CustomerActivitySource>();
        return services;
    }
}
