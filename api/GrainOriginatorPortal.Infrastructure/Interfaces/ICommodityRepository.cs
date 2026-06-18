using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Read-only access to commodity reference data (app DB) and unit conversions (ODS).</summary>
public interface ICommodityRepository
{
    /// <summary>Active commodities, ordered by name.</summary>
    Task<IReadOnlyList<Commodity>> GetActiveAsync(CancellationToken cancellationToken);

    /// <summary>Active commodities flagged for the Planting Intentions crop dropdown, ordered by name.</summary>
    Task<IReadOnlyList<Commodity>> GetPlantingAsync(CancellationToken cancellationToken);

    /// <summary>Commodity unit conversions (lbs per unit > 0) from the ODS.</summary>
    Task<IReadOnlyList<CommodityConversion>> GetConversionsAsync(CancellationToken cancellationToken);

    /// <summary>Active harvest windows (app DB).</summary>
    Task<IReadOnlyList<HarvestWindow>> GetHarvestWindowsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Syncs the Commodities table from ODS contract/ticket data (adds missing codes, backfills
    /// categories). Called once at app startup. Returns the total active commodity count.
    /// </summary>
    Task<int> SyncAsync(CancellationToken cancellationToken);
}
