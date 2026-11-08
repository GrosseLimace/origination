// Project namespaces
using GrainOriginatorPortal.Api.Modules.Lists.Services;
using GrainOriginatorPortal.Infrastructure.Modules.Lists;

namespace GrainOriginatorPortal.Api.Modules.Lists;

/// <summary>
/// The Lists module: saved lists (your own, and your team's for managers) and the query library. Build-a-List,
/// its customer map and Actionable Insights run in the browser over the other modules' endpoints, so they have
/// nothing to register here. Its controllers are found by MVC; this registers what they depend on.
/// </summary>
public static class ListsModule
{
    public static IServiceCollection AddListsModule(this IServiceCollection services)
    {
        services.AddListsInfrastructure();

        services.AddScoped<ISavedListService, SavedListService>();
        services.AddScoped<IQueryLibraryService, QueryLibraryService>();
        return services;
    }
}
