using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Everything the producer-details upsert needs, as one record — the positional signature had
/// grown to 12 parameters and every new child collection broke every call site. Null vs empty
/// matters for <see cref="Contacts"/>: null means the caller didn't send contacts (old client
/// during a deploy window) and existing rows must be preserved; an empty list is an explicit
/// "remove them all".
/// </summary>
public sealed record ProducerDetailsUpsertArgs
{
    public required long CustomerId { get; init; }
    public string? ScoularId { get; init; }
    public required string CustomerName { get; init; }
    public decimal? TotalAcres { get; init; }
    public decimal? BinCapacity { get; init; }
    /// <summary>Legacy single-contact fields — used only when <see cref="Contacts"/> is null;
    /// otherwise both are derived from the primary contact row (dual-write).</summary>
    public string? PrimaryContact { get; init; }
    public string? PrimaryPhone { get; init; }
    public string? Commodities { get; init; }
    public string? LinkedProducerIds { get; init; }
    public IReadOnlyList<GrainOnFarmEntry> GrainOnFarm { get; init; } = [];
    public IReadOnlyList<ProducerContactEntry>? Contacts { get; init; }
    /// <summary>Same null-vs-empty contract as <see cref="Contacts"/>: null preserves the existing
    /// bin-site rows, an empty list removes them all.</summary>
    public IReadOnlyList<ProducerBinSiteEntry>? BinSites { get; init; }
}

/// <summary>
/// Persistence for producer details. CustomerName/ScoularId and the LinkedProducerIds /
/// Commodities CSVs are composed from the related Customer / CustomerLink / CustomerCommodity
/// tables (those columns were dropped from dbo.ProducerDetails). GrainOnFarm, Contacts and BinSites are
/// composed from their child tables and rebuilt as a set on upsert. CreatedBy/ModifiedBy
/// display-name enrichment is done by the caller; the owning user is passed into Upsert.
/// </summary>
public interface IProducerDetailsRepository
{
    Task<ProducerDetails?> GetAsync(long customerId, CancellationToken cancellationToken);
    Task<List<ProducerDetails>> GetAllAsync(CancellationToken cancellationToken);
    Task<ProducerDetails> UpsertAsync(ProducerDetailsUpsertArgs args, string currentUser, CancellationToken cancellationToken);
    /// <summary>Deletes a producer's details and hand-cascades the ProducerContacts,
    /// ProducerBinSites and ProducerGrainOnFarm child rows. Returns false when no details row existed.</summary>
    Task<bool> DeleteAsync(long customerId, string currentUser, CancellationToken cancellationToken);
}
