// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>Registers the access services (plan §4.3). Phase 2 folds this into <c>AddPlatform()</c>.</summary>
public static class AccessServiceCollectionExtensions
{
    public static IServiceCollection AddAccess(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<AccessOptions>().Bind(configuration.GetSection(AccessOptions.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<IUserRoleSource, ClaimsUserRoleSource>();
        services.AddSingleton<IRoleGrantCache, RoleGrantCache>();
        services.AddScoped<IPermissionService, PermissionService>();
        return services;
    }
}
