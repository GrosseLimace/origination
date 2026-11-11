// Project namespaces
using GrainOriginatorPortal.Api.Modules.Producers.Services;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;
using GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

namespace GrainOriginatorPortal.Api.Modules.Producers.Controllers;

/// <summary>
/// Linked producers: the customers that link to a producer (dbo.CustomerLink). Linking is producer data, so it
/// needs producer-details:read. The route stays under <c>api/customers</c>, where it began, so the client
/// doesn't change.
/// </summary>
[ApiController]
[Route("api/customers")]
[RequirePermission(AppPermissions.Producers.ProducerDetailsRead)]
[Produces("application/json")]
public class LinkedProducersController : ControllerBase
{
    private readonly IProducerDetailsService _service;

    public LinkedProducersController(IProducerDetailsService service)
    {
        _service = service;
    }

    /// <summary>Gets the customers that link TO this one (incoming / reverse links). Used by the cross-customer search
    /// path so the customer profile can show bidirectional linked producers even when no TU is selected; their own
    /// links and acres come with their producer details.</summary>
    [HttpGet("linked-to/{sourceId}")]
    [ProducesResponseType(typeof(List<CustomerResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerResponse>>> GetLinkedTo(string sourceId, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz is intentional — linked producers deliberately span
        // trade units; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetLinkedToAsync(sourceId, cancellationToken));
    }
}
