using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IProducerDetailsService _service;
    private readonly ILogger<ProducerDetailsController> _logger;

    public ProducerDetailsController(IProducerDetailsService service, ILogger<ProducerDetailsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all producer details records, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProducerDetailsResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ProducerDetailsResponse>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets producer details for a specific customer, if that producer is in a trade unit
    /// the caller is entitled to. Returns an empty record if none is saved; 403 when the producer
    /// belongs to another trade unit.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ProducerDetailsResponse>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        // Do NOT re-cite AR-02 here. This route was removed from that entry on 2026-09-14 and is
        // trade-unit authorized in ProducerDetailsService — the response carries ProducerContact
        // PII (names, phones, emails) and no client path needs it cross-trade-unit. The sibling
        // PUT is a different case and stays under AR-01; see the service for why.
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates producer details for a customer.</summary>
    [HttpPut("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetailsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ProducerDetailsResponse>> Upsert(long customerId, [FromBody] UpsertProducerDetailsRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may save producer details for any customer.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        var details = await _service.UpsertAsync(customerId, request, cancellationToken);
        return Ok(details);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes producer details for a customer, if that producer is in a trade unit the
    /// caller is entitled to. Returns 204 whether or not a record existed; 403 when it belongs to
    /// another trade unit.</summary>
    [HttpDelete("customer/{customerId:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(long customerId, CancellationToken cancellationToken = default)
    {
        // Do NOT re-cite AR-01 here. Unlike the sibling PUT above, this route was removed from that
        // entry on 2026-09-14 (H-062) and is trade-unit authorized in ProducerDetailsService: it has
        // no client caller, it hand-cascades to contact and grain-on-farm rows that exist nowhere
        // upstream, and AR-01's audit compensating control was not actually implemented for it.
        var deleted = await _service.DeleteAsync(customerId, cancellationToken);

        // A miss is logged too, so an enumeration sweep leaves a trail rather than silence.
        if (!deleted)
        {
            _logger.LogInformation(
                "Producer details delete found no record [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId}",
                "AUDIT_DELETE", "DataMutation", customerId);
        }

        return NoContent();
    }
}
