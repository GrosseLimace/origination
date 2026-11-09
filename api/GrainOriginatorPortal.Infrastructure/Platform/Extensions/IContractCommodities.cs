namespace GrainOriginatorPortal.Infrastructure.Platform.Extensions;

/// <summary>
/// The commodities that appear on purchase contracts. The commodity seed on the diagnostics page fills Platform's
/// reference-data commodity list from them, but contracts belong to the Contracts module, which implements this.
/// </summary>
/// <remarks>
/// There is no fallback. If no module provides this, resolving the commodity seed fails loudly.
/// </remarks>
public interface IContractCommodities
{
    /// <summary>
    /// The distinct commodity code and description pairs on ODS purchase contracts that carry both, as stored
    /// (untrimmed).
    /// </summary>
    Task<List<(string Code, string Description)>> GetPurchaseContractCommoditiesAsync(CancellationToken cancellationToken);
}
