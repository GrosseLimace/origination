using GrainOriginatorPortal.Api.Modules.Producers.Models.Requests;
using GrainOriginatorPortal.Api.Modules.Producers.Models.Responses;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Modules.Producers.Services;

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

    /// <summary>
    /// The active customers that link to the producer with this CTRM code (incoming linked producers), each
    /// with its total acres and the codes it links to, so the client can follow chains. Not limited by trade
    /// unit: linked producers deliberately span trade units (AR-02).
    /// </summary>
    Task<List<CustomerResponse>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken);
}
