// Project namespaces
using GrainOriginatorPortal.Api.Modules.Customers.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Customers;

namespace GrainOriginatorPortal.Api.Modules.Customers;

/// <summary>
/// The Customers module: the customer master, search, the onboarding search, trade-unit assignments and the
/// customer sync with its diagnostics. Its controllers are found by MVC; this registers what they depend on.
/// Other modules ask about customers through <see cref="ICustomerLookup"/>.
/// </summary>
public static class CustomersModule
{
    public static IServiceCollection AddCustomersModule(this IServiceCollection services)
    {
        services.AddCustomersInfrastructure();

        services.AddScoped<ICustomerService, CustomerService>();
        services.AddScoped<ICustomerLookup, CustomerLookup>();

        // Customer sync: a daily upsert from the configured feeder (CustomerSync:Source) into dbo.Customer and
        // dbo.CustomerTradeUnit. A singleton so the scheduled run and the manual run on
        // CustomerSyncDiagnosticsController share one code path and one record of the last run.
        services.AddSingleton<CustomerSyncService>();
        services.AddHostedService<CustomerSyncBackgroundService>();
        return services;
    }
}
