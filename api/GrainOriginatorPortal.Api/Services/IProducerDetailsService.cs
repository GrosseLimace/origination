using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>User-entered producer details. The list is scoped to the caller's entitled trade units;
/// CreatedBy/ModifiedBy are resolved to display names.</summary>
public interface IProducerDetailsService
{
    Task<List<ProducerDetailsResponse>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Producer details for a customer, or an empty record (CustomerId only) when none is saved.</summary>
    Task<ProducerDetailsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken);

    Task<ProducerDetailsResponse> UpsertAsync(long customerId, UpsertProducerDetailsRequest request, CancellationToken cancellationToken);

    /// <summary>Deletes a producer's details after authorizing the customer against the caller's
    /// entitled trade units. Returns false when no details row existed. Throws ForbiddenException
    /// when the producer is outside the caller's entitlements (H-062 — this route is NOT covered by
    /// AR-01; see ProducerDetailsService.DeleteAsync).</summary>
    Task<bool> DeleteAsync(long customerId, CancellationToken cancellationToken);
}
