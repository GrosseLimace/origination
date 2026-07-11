using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GrainOriginatorPortal.Infrastructure;

/// <summary>
/// POC-only DI wiring for the field-tagging feature. Deliberately kept out of
/// <see cref="DependencyInjection.AddInfrastructure"/> so the whole POC unplugs by deleting this
/// file and its call site in Program.cs — see docs/poc/field-tagging/01-data-model.md.
/// </summary>
public static class FieldTagsPocDependencyInjection
{
    /// <summary>
    /// Registers <see cref="FieldTagDbContext"/> (local SQLite) and <see cref="IFieldTagRepository"/>
    /// when — and only when — FieldTags:LocalStorePath is configured. When the key is absent, the
    /// feature stays dormant: no context, no repository, nothing registered.
    /// </summary>
    public static IServiceCollection AddFieldTagsPoc(
        this IServiceCollection services,
        IConfiguration configuration,
        string contentRootPath)
    {
        var localStorePath = configuration["FieldTags:LocalStorePath"];
        if (string.IsNullOrWhiteSpace(localStorePath))
        {
            return services;
        }

        var resolvedPath = Path.IsPathRooted(localStorePath)
            ? localStorePath
            : Path.Combine(contentRootPath, localStorePath);

        var directory = Path.GetDirectoryName(resolvedPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        services.AddDbContext<FieldTagDbContext>(options =>
        {
            options.UseSqlite($"Data Source={resolvedPath}");
        });

        services.AddScoped<IFieldTagRepository, FieldTagRepository>();

        return services;
    }
}
