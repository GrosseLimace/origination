using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>User-entered producer details. The list is scoped to the caller's entitled trade units;
/// CreatedBy/ModifiedBy are resolved to display names.</summary>
public interface IProducerDetailsService
{
    Task<List<ProducerDetailsResponse>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Producer details for a customer, or an empty record (CustomerId only) when none is saved.</summary>
    Task<ProducerDetailsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);

    Task<ProducerDetailsResponse> UpsertAsync(long customerId, string? scoularId, string customerName,
        decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities,
        string? linkedProducerIds, CancellationToken cancellationToken);

    Task DeleteAsync(long customerId, CancellationToken cancellationToken);
}
