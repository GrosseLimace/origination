// Microsoft namespaces
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// Names of the customer-sync feeders and the rule that picks one per run from
/// <c>CustomerSync:Source</c>. Same convention as <c>ContractRepositorySwitch</c>: only the literal
/// <c>ctrm</c> (trimmed, case-insensitive) opts in; an empty, absent or misspelled value stays on ODS.
/// </summary>
public static class CustomerSyncSources
{
    public const string Ods = "ods";
    public const string Ctrm = "ctrm";
    public const string ConfigKey = "CustomerSync:Source";

    public static string Resolve(IConfiguration configuration) =>
        string.Equals(configuration[ConfigKey]?.Trim(), Ctrm, StringComparison.OrdinalIgnoreCase) ? Ctrm : Ods;
}
