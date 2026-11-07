using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Models.Responses;
using GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Services;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Modules.Producers.FieldPlan.Controllers;

/// <summary>
/// A producer's CTRM splits (combined customer IDs). Each is one field in the producer's field plan, and
/// tickets are delivered under it. Empty while split IDs are typed by hand (the go-live default), sample data in local demos, until the CTRM splits query is confirmed; the response's
/// <c>source</c> says which.
/// </summary>
[RequirePermission(AppPermissions.Producers.FieldPlansRead)]
[ApiController]
[Route("api/ctrm-splits")]
[Produces("application/json")]
public class CtrmSplitsController : ControllerBase
{
    private readonly IProducerSplitService _service;

    public CtrmSplitsController(IProducerSplitService service)
    {
        _service = service;
    }

    /// <summary>Every split under the producer, including expired and bin-site ones (the screen filters).</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerSplitsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<ProducerSplitsResponse>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        // Open to any rep, as planting intentions and a producer's contracts are; see ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }
}
