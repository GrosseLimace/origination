// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Lists.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.Lists;

/// <summary>
/// The Lists module's repositories: saved lists and the query library. <c>AddListsModule</c> in the Api calls this.
/// </summary>
public static class ListsInfrastructure
{
    public static IServiceCollection AddListsInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<ISavedListRepository, SavedListRepository>();
        services.AddScoped<IQueryLibraryRepository, QueryLibraryRepository>();
        return services;
    }
}
