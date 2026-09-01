using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Org-hierarchy lookups for the usage dashboard's manager filter, backed by TradeUnitPreferences
/// dbo.vw_UserManagerLookup. The whole directory (~1,150 rows) is cached in memory; subtree math
/// happens in C# because the TradeUnitPreferences and Origination databases can't be joined in SQL.
/// </summary>
public interface IManagerDirectoryService
{
    /// <summary>Distinct active managers (anyone appearing as another user's ManagerUserId),
    /// name-sorted, with direct and total report counts. Throws
    /// <see cref="Exceptions.InfrastructureException"/> (503) when the TradeUnitPreferences DB
    /// is unreachable.</summary>
    Task<List<UsageManagerDto>> GetManagersAsync(CancellationToken cancellationToken);

    /// <summary>Case-insensitive short-name set of the manager's entire subtree, INCLUDING the
    /// manager themself. Null when <paramref name="managerId"/> is not a known active manager.
    /// Throws <see cref="Exceptions.InfrastructureException"/> (503) when the TradeUnitPreferences
    /// DB is unreachable — the dashboard fails closed rather than silently widening a
    /// manager-filtered view to the whole org.</summary>
    Task<HashSet<string>?> GetSubtreeUserIdsAsync(string managerId, CancellationToken cancellationToken);
}
