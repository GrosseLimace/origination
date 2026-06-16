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

    public ProducerDetailsController(IProducerDetailsService service)
    {
        _service = service;
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
    /// <summary>Gets producer details for a specific customer. Returns an empty record if not yet saved.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetailsResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProducerDetailsResponse>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
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
        var details = await _service.UpsertAsync(
            customerId,
            request.ScoularId,
            request.CustomerName,
            request.TotalAcres,
            request.BinCapacity,
            request.PrimaryContact,
            request.Commodities,
            request.LinkedProducerIds,
            cancellationToken
        );
        return Ok(details);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes producer details for a customer.</summary>
    [HttpDelete("customer/{customerId:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(long customerId, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any producer's details.
        await _service.DeleteAsync(customerId, cancellationToken);
        return NoContent();
    }
}
