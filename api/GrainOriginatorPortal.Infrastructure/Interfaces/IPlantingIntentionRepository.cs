using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for producer planting intentions (dbo.ProducerPlantingIntentions). CustomerName/
/// CustomerCode are composed from the Customer FK join (those columns were dropped from the table).
/// CreatedBy/ModifiedBy display-name enrichment is done by the caller; the owning user is passed in.
/// </summary>
public interface IPlantingIntentionRepository
{
    Task<List<PlantingIntention>> GetAsync(IEnumerable<string>? tradeUnits, int? plantingYear, CancellationToken cancellationToken);
    Task<List<PlantingIntention>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);
    Task<PlantingIntention?> GetByIdAsync(int intentionId, CancellationToken cancellationToken);
    Task<PlantingIntention> AddAsync(long customerId, string customerName, string customerCode, string tradeUnit,
        string crop, string? category, string? type, string? description, int acres, int plantingYear,
        string currentUser, CancellationToken cancellationToken);
    /// <summary>Updates a row. <paramref name="tradeUnit"/> null = leave the stored trade unit unchanged;
    /// the service has already validated a non-null value against the producer's memberships.</summary>
    Task<PlantingIntention?> UpdateAsync(int intentionId, string crop, string? category, string? type,
        string? description, int acres, int plantingYear, string? tradeUnit, string currentUser, CancellationToken cancellationToken);

    /// <summary>Repoints every row of this customer tagged <paramref name="fromTradeUnit"/> at
    /// <paramref name="toTradeUnit"/>. Returns how many rows moved. The service validates the target.
    /// Soft-deleted rows are excluded by the entity's query filter.</summary>
    Task<int> RetagAsync(long customerId, string fromTradeUnit, string toTradeUnit, string currentUser, CancellationToken cancellationToken);

    /// <summary>Soft-deletes the intention, stamping IsDeleted/DeletedAt/DeletedBy.</summary>
    Task DeleteAsync(int intentionId, string currentUser, CancellationToken cancellationToken);
}
