// Microsoft namespaces
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection.Extensions;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Platform.Access;

/// <summary>Registers the access services.</summary>
public static class AccessServiceCollectionExtensions
{
    public static IServiceCollection AddAccess(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<AccessOptions>().Bind(configuration.GetSection(AccessOptions.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<IUserRoleSource, ClaimsUserRoleSource>();
        services.AddSingleton<IRoleGrantCache, RoleGrantCache>();
        services.AddScoped<IPermissionService, PermissionService>();

        // One policy per catalog permission, for [RequirePermission].
        // - A named policy replaces the default policy rather than adding to it, so each permission policy
        //   starts from the default policy's requirements and adds the permission on top. Without this, a
        //   permission policy would skip whatever the default policy requires beyond sign-in.
        // - PostConfigure runs after every AddAuthorization(...) setup, so each policy copies the default
        //   policy as it finally stands, including anything added to it later.
        services.AddOptions<AuthorizationOptions>().PostConfigure(options =>
        {
            foreach (var permission in AppPermissions.All)
            {
                options.AddPolicy(RequirePermissionAttribute.PolicyFor(permission), policy => policy
                    .Combine(options.DefaultPolicy)
                    .AddRequirements(new PermissionRequirement(permission)));
            }
        });

        // Scoped, like the IPermissionService it asks. The authorization middleware resolves handlers from
        // the request's services.
        services.AddScoped<IAuthorizationHandler, PermissionRequirementHandler>();
        return services;
    }
}
