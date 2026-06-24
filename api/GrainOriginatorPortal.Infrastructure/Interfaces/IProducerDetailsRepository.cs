using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Persistence for producer details. CustomerName/ScoularId and the LinkedProducerIds /
/// Commodities CSVs are composed from the related Customer / CustomerLink / CustomerCommodity
/// tables (those columns were dropped from dbo.ProducerDetails). CreatedBy/ModifiedBy display-name
/// enrichment is done by the caller; the owning user is passed into Upsert.
/// </summary>
public interface IProducerDetailsRepository
{
    Task<ProducerDetails?> GetAsync(long customerId, CancellationToken cancellationToken);
    Task<List<ProducerDetails>> GetAllAsync(CancellationToken cancellationToken);
    Task<ProducerDetails> UpsertAsync(long customerId, string? scoularId, string customerName, decimal? totalAcres,
        decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds,
        IReadOnlyList<GrainOnFarmEntry> grainOnFarm, string currentUser, CancellationToken cancellationToken);
    Task DeleteAsync(long customerId, CancellationToken cancellationToken);
}
