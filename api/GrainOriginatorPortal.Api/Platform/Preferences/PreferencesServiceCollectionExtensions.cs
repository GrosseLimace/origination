namespace GrainOriginatorPortal.Api.Platform.Preferences;

public static class PreferencesServiceCollectionExtensions
{
    /// <summary>
    /// The signed-in user's saved preferences and trade units, the trade-unit list, and the entitlements directory
    /// the recap-group and mention pickers read.
    /// </summary>
    public static IServiceCollection AddPreferences(this IServiceCollection services)
    {
        services.AddScoped<IUserPreferenceService, UserPreferenceService>();
        services.AddScoped<IUserTradeUnitService, UserTradeUnitService>();
        services.AddScoped<ITradeUnitService, TradeUnitService>();
        services.AddScoped<IEntitlementsDirectoryService, EntitlementsDirectoryService>();
        return services;
    }
}
