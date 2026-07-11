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
        decimal? binCapacity, string? primaryContact, string? primaryPhone, string? commodities, string? linkedProducerIds,
        IReadOnlyList<GrainOnFarmEntry> grainOnFarm, string currentUser, CancellationToken cancellationToken);
    Task DeleteAsync(long customerId, CancellationToken cancellationToken);

    /// <summary>
    /// POC (field-tagging): narrowly updates only TotalAcres, leaving every other ProducerDetails
    /// field untouched. Creates the one-row-per-customer record if it doesn't exist yet, resolving
    /// CustomerName/ScoularId from dbo.Customer. Deliberately does NOT reuse UpsertAsync's full
    /// signature — that path rebuilds CustomerLink/CustomerCommodity/ProducerGrainOnFarm from
    /// caller-supplied CSVs, which would wipe those out here since the acres action never has them.
    /// See docs/poc/field-tagging/02-backend-api.md.
    /// </summary>
    Task<ProducerDetails> UpdateTotalAcresAsync(long customerId, decimal totalAcres, string currentUser, CancellationToken cancellationToken);
}
