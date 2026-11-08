// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Ctrm;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Repositories;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Sync;

namespace GrainOriginatorPortal.Infrastructure.Modules.Customers;

/// <summary>
/// The Customers module's repositories, its CTRM customer readers and the customer sync's two feeders.
/// <c>AddCustomersModule</c> in the Api calls this.
/// </summary>
public static class CustomersInfrastructure
{
    public static IServiceCollection AddCustomersInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<ICustomerRepository, CustomerRepository>();
        services.AddScoped<ICustomerSyncRepository, CustomerSyncRepository>();

        // Customer sync. The CTRM customer readers are singletons like CtrmContractReader: they share the
        // singleton ICtrmGraphQlClient and hold no per-request state. The feeders and the factory are SCOPED
        // because the feeders hold the scoped ICustomerSyncRepository; CustomerSyncService resolves the factory
        // from each run's own scope, never from the root.
        services.AddSingleton<CtrmCustomerReader>();
        services.AddSingleton<CtrmCustomerActivityReader>();
        services.AddScoped<OdsCustomerSyncSource>();
        services.AddScoped<CtrmCustomerSyncSource>();
        services.AddScoped<ICustomerSyncSourceFactory, CustomerSyncSourceFactory>();
        return services;
    }
}
