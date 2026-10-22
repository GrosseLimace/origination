// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>Creates the feeder named by <see cref="CustomerSyncSources.Resolve"/> (or a dry-run override).</summary>
public interface ICustomerSyncSourceFactory
{
    /// <summary><c>"ctrm"</c> → <see cref="CtrmCustomerSyncSource"/>, else <see cref="OdsCustomerSyncSource"/>.</summary>
    ICustomerSyncSource Create(string sourceName);
}

/// <summary>
/// Resolves the feeder from the caller's scope (sources are scoped: they hold the scoped sync
/// repository). Only the literal <c>ctrm</c> (trimmed, case-insensitive) selects the CTRM feeder, the
/// same opt-in rule as <see cref="CustomerSyncSources.Resolve"/>.
/// </summary>
public sealed class CustomerSyncSourceFactory : ICustomerSyncSourceFactory
{
    private readonly IServiceProvider _serviceProvider;

    public CustomerSyncSourceFactory(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider ?? throw new ArgumentNullException(nameof(serviceProvider));
    }

    public ICustomerSyncSource Create(string sourceName) =>
        string.Equals(sourceName?.Trim(), CustomerSyncSources.Ctrm, StringComparison.OrdinalIgnoreCase)
            ? _serviceProvider.GetRequiredService<CtrmCustomerSyncSource>()
            : _serviceProvider.GetRequiredService<OdsCustomerSyncSource>();
}
