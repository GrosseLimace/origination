// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Field-tagging POC CRUD + calculated-acres action, customer-scoped. No new ACL — anyone who can
/// view the Customer Profile can see/edit field tags, the same posture as Notes/ProducerDetails;
/// see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01/AR-02). Deviates from [Route("api/[controller]")]
/// deliberately — every operation here is intrinsically customer-scoped (the dedup index and the
/// acres action are both per-customer) — see docs/maps/field-tagging/02-backend-api.md.
/// </summary>
[ApiController]
[Route("api/customers/{customerId:long}/field-tags")]
[Authorize]
[Produces("application/json")]
public class FieldTagsController : ControllerBase
{
    private readonly IFieldTagService _service;
    private readonly ILogger<FieldTagsController> _logger;

    public FieldTagsController(IFieldTagService service, ILogger<FieldTagsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all active field tags for a customer. Returns an empty array when the
    /// feature is unconfigured. Open to any authenticated originator — trade-unit entitlements
    /// are a UX default, not an access-control boundary.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<FieldTagResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<FieldTagResponse>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a field tag for a customer.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(FieldTagResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<FieldTagResponse>> Create(long customerId, [FromBody] CreateFieldTagRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may tag a field for any customer.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        var tag = await _service.CreateAsync(customerId, request, cancellationToken);
        _logger.LogInformation(
            "Field tag created [{ErrorCode}] [{ErrorCategory}]: TagId={TagId}, CustomerId={CustomerId}, SelectionMethod={SelectionMethod}",
            "AUDIT_CREATE", "DataMutation", tag.Id, customerId, tag.SelectionMethod);
        return Created($"/api/customers/{customerId}/field-tags/{tag.Id}", tag);
    }

    // -------------------------------------------------------------------------
    /// <summary>Soft-deletes a field tag.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Delete(long customerId, int id, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any field tag.
        await _service.DeleteAsync(customerId, id, cancellationToken);
        _logger.LogInformation(
            "Field tag deleted [{ErrorCode}] [{ErrorCategory}]: TagId={TagId}, CustomerId={CustomerId}",
            "AUDIT_DELETE", "DataMutation", id, customerId);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    /// <summary>Overwrites ProducerDetails.TotalAcres with the sum of CalcAcres across all of this
    /// customer's active field tags. Collection-level (not per-tag) — see 02-backend-api.md for why.</summary>
    [HttpPost("apply-calculated-acres")]
    [ProducesResponseType(typeof(ApplyCalculatedAcresResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ApplyCalculatedAcresResponse>> ApplyCalculatedAcres(long customerId, CancellationToken cancellationToken = default)
    {
        var result = await _service.ApplyCalculatedAcresAsync(customerId, cancellationToken);
        _logger.LogInformation(
            "Applied calculated acres [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId}, TagCount={TagCount}, TotalAcres={TotalAcres}",
            "AUDIT_UPDATE", "DataMutation", customerId, result.TagCount, result.TotalAcres);
        return Ok(result);
    }
}
