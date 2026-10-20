using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GrainOriginatorPortal.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers the Infrastructure layer's EF Core DbContexts (ODS read-only, application
    /// read/write, and entitlements read-only). <paramref name="isDevelopment"/> enables EF
    /// sensitive-data logging / detailed errors in Debug builds only.
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isDevelopment = false)
    {
        // ODS — read-only views. 2-minute command timeout for large queries.
        services.AddDbContext<OriginationDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("ODSConnection");
            options.UseSqlServer(connectionString, sqlOptions =>
            {
                sqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorNumbersToAdd: null);
                sqlOptions.CommandTimeout(120);
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // Application-owned tables in the Origination database.
        services.AddDbContext<ApplicationDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("OriginationConnection");
            options.UseSqlServer(connectionString, sqlOptions =>
            {
                sqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorNumbersToAdd: null);
                sqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "dbo");
                // Match the ODS contexts: the app DB serves the same wide dashboard/usage reads,
                // and the team already knows SQL's 30s default is sometimes too tight here.
                sqlOptions.CommandTimeout(120);
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // DP-contract ODS reads. "ODSDpConnection" is not set in any environment, so this resolves to
        // ODSConnection and every environment reads its own ODS — identical to OriginationDbContext.
        // The key exists only as an opt-in local escape hatch for validating DP values against an ODS
        // that has data (see DpOdsDbContext for the rationale, the read-only safety argument, and why
        // it must never be set in a deployed environment).
        services.AddDbContext<DpOdsDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("ODSDpConnection")
                ?? configuration.GetConnectionString("ODSConnection");
            options.UseSqlServer(connectionString, sqlOptions =>
            {
                sqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorNumbersToAdd: null);
                sqlOptions.CommandTimeout(120);
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // TradeUnitPreferences — read-only access for user trade-unit assignments. Managers assign
        // these in the separate trade-unit preferences app; this app never writes here.
        services.AddDbContext<TradeUnitPreferencesDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("TradeUnitPreferencesConnection");
            options.UseSqlServer(connectionString, sqlOptions =>
            {
                sqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorNumbersToAdd: null);
                // Explicit rather than inheriting SQL's 30s default — entitlement lookups gate
                // every scoped read, and a timeout here fails the request closed.
                sqlOptions.CommandTimeout(120);
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // Singleton so one date-window fetch is shared by every request and every producer, rather
        // than each scoped repository paging the window again. ICtrmGraphQlClient is registered in
        // the Api project (it needs IHttpClientFactory and a credential).
        // Live per-producer readers. Singleton so their short request-coalescing cache is shared:
        // selecting a producer triggers the contract list, the pricing lines and the pacing card, which all
        // want the same rows, so one CTRM call serves all three instead of three identical round trips.
        services.AddSingleton<CtrmContractReader>();
        services.AddSingleton<CtrmTicketReader>();
        services.AddSingleton<CtrmWarmRegistry>();


        // Scoped: one per HTTP request, so the provenance middleware reports what THIS request's
        // repositories actually did rather than what was configured when it arrived.
        services.AddScoped<CtrmProvenance>();

        // ── Repositories (per-domain, added incrementally during the Phase 2 migration) ──
        services.AddScoped<IQueryLibraryRepository, QueryLibraryRepository>();
        services.AddScoped<ICommodityRepository, CommodityRepository>();
        services.AddScoped<IStoredGrainRepository, StoredGrainRepository>();
        services.AddScoped<IDpContractRepository, DpContractRepository>();
        services.AddScoped<ISavedListRepository, SavedListRepository>();
        services.AddScoped<IDisplayNameLookupRepository, DisplayNameLookupRepository>();
        services.AddScoped<IProducerDetailsRepository, ProducerDetailsRepository>();
        services.AddScoped<IPlantingIntentionRepository, PlantingIntentionRepository>();
        services.AddScoped<INoteRepository, NoteRepository>();
        services.AddScoped<IReminderRepository, ReminderRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        // Tickets follow the same switch pattern as contracts. The CTRM ticket repository still needs
        // the ODS one — for the ticket-key index, the storage gate and the location lookup, none of
        // which CTRM can supply.
        services.AddScoped<TicketRepository>();
        services.AddScoped<CtrmTicketRepository>();
        services.AddScoped<ITicketRepository, TicketRepositorySwitch>();

        // Contracts resolve through a switch that picks ODS or CTRM per call from Ctrm:Source.
        // Both concrete repositories are registered because the switch holds one of each, and the
        // CTRM one delegates the reads it cannot serve (pacing history, crop year, farm, by-number)
        // straight to the ODS one. Default is ODS — see ContractRepositorySwitch.
        services.AddScoped<ContractRepository>();
        services.AddScoped<CtrmContractRepository>();
        services.AddScoped<IContractRepository, ContractRepositorySwitch>();
        services.AddScoped<IBidSheetRepository, BidSheetRepository>();
        services.AddScoped<IBarchartIngestRepository, BarchartIngestRepository>();
        services.AddScoped<IBarchartCatalogRepository, BarchartCatalogRepository>();
        services.AddScoped<ICustomerRepository, CustomerRepository>();
        services.AddScoped<IUserPreferenceRepository, UserPreferenceRepository>();
        services.AddScoped<IEntitlementsRepository, EntitlementsRepository>();
        services.AddScoped<IUsageRepository, UsageRepository>();
        services.AddScoped<ICustomerSyncRepository, CustomerSyncRepository>();
        services.AddScoped<IDailyRecapGroupRepository, DailyRecapGroupRepository>();
        services.AddScoped<ITeamsChannelRepository, TeamsChannelRepository>();
        services.AddScoped<IMbpLocationSynonymRepository, MbpLocationSynonymRepository>();

        return services;
    }
}
