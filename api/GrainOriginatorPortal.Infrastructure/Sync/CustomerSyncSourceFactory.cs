// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>Creates the feeder named by <see cref="CustomerSyncSources.Resolve"/> (or a dry-run override).</summary>
public interface ICustomerSyncSourceFactory
{
    /// <summary><c>"ctrm"</c> → <c>CtrmCustomerSyncSource</c>, else <see cref="OdsCustomerSyncSource"/>.</summary>
    ICustomerSyncSource Create(string sourceName);
}

/// <summary>
/// Resolves the feeder from the caller's scope (sources are scoped: they hold the scoped sync
/// repository).
/// </summary>
public sealed class CustomerSyncSourceFactory : ICustomerSyncSourceFactory
{
    private readonly IServiceProvider _serviceProvider;

    public CustomerSyncSourceFactory(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider ?? throw new ArgumentNullException(nameof(serviceProvider));
    }

    public ICustomerSyncSource Create(string sourceName)
    {
        // C4a wires "ctrm": until CtrmCustomerSyncSource exists, both names resolve to the ODS feeder.
        return _serviceProvider.GetRequiredService<OdsCustomerSyncSource>();
    }
}
