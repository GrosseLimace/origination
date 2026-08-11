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
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // Entitlements — read-only access for user trade-unit assignments.
        services.AddDbContext<EntitlementsDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("EntitlementsConnection");
            options.UseSqlServer(connectionString, sqlOptions =>
            {
                sqlOptions.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(30),
                    errorNumbersToAdd: null);
            });
#if DEBUG
            if (isDevelopment)
            {
                options.EnableSensitiveDataLogging();
                options.EnableDetailedErrors();
            }
#endif
        });

        // ── Repositories (per-domain, added incrementally during the Phase 2 migration) ──
        services.AddScoped<IQueryLibraryRepository, QueryLibraryRepository>();
        services.AddScoped<ICommodityRepository, CommodityRepository>();
        services.AddScoped<IStoredGrainRepository, StoredGrainRepository>();
        services.AddScoped<ISavedListRepository, SavedListRepository>();
        services.AddScoped<IDisplayNameLookupRepository, DisplayNameLookupRepository>();
        services.AddScoped<IProducerDetailsRepository, ProducerDetailsRepository>();
        services.AddScoped<IFarmRepository, FarmRepository>();
        services.AddScoped<IPlantingIntentionRepository, PlantingIntentionRepository>();
        services.AddScoped<INoteRepository, NoteRepository>();
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        services.AddScoped<ITicketRepository, TicketRepository>();
        services.AddScoped<IContractRepository, ContractRepository>();
        services.AddScoped<IBidSheetRepository, BidSheetRepository>();
        services.AddScoped<IBarchartIngestRepository, BarchartIngestRepository>();
        services.AddScoped<ICustomerRepository, CustomerRepository>();
        services.AddScoped<IUserPreferenceRepository, UserPreferenceRepository>();
        services.AddScoped<IEntitlementsRepository, EntitlementsRepository>();
        services.AddScoped<IUsageRepository, UsageRepository>();
        services.AddScoped<ICustomerSyncRepository, CustomerSyncRepository>();
        services.AddScoped<IDailyRecapGroupRepository, DailyRecapGroupRepository>();
        services.AddScoped<IMbpLocationSynonymRepository, MbpLocationSynonymRepository>();

        return services;
    }
}
