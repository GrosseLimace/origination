using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Reads organic certification for the producer profile.
///
/// Separate from <see cref="OrganicCertificationIngestController"/> on purpose: that one is written
/// to by a machine identity on a dedicated policy, this one is read by signed-in users. Keeping
/// them apart means the ingest policy cannot be widened by accident while adding a read.
///
/// NOT trade-unit scoped, and deliberately so — do not cite AR-02 here. The criterion this codebase
/// applies (stated in ProducerDetailsController) is whether the response carries PII and whether
/// any client path needs it cross-trade-unit. This payload is a NOP id, a status, dates and crop
/// names: public-registry facts with no personal data, and the source's contact block is neither
/// stored nor returned. Kate Hoegermeyer confirmed certification status is not confidential, and
/// All Producers and linked-producer navigation both reach producers across trade units by design.
/// </summary>
[ApiController]
[Route("api/organic-certifications")]
[Authorize]
[Produces("application/json")]
public class OrganicCertificationsController : ControllerBase
{
    private readonly IOrganicCertificationService _service;

    public OrganicCertificationsController(IOrganicCertificationService service)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
    }

    /// <summary>
    /// Certification for one producer.
    /// </summary>
    /// <remarks>
    /// Always returns a record, never a 404 — matching <c>GET /api/producerdetails/customer/{id}</c>.
    /// Three states are distinguishable and all three render:
    ///
    /// - no NOP id on file: <c>nopid</c> null, no certification
    /// - a NOP id with nothing behind it: <c>noCertificateOnFile</c> true — show the id and warn
    /// - a certification: statuses per scope, with crops grouped under each
    /// </remarks>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(CustomerOrganicCertificationResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CustomerOrganicCertificationResponse>> GetForCustomer(
        long customerId, CancellationToken cancellationToken = default)
        => Ok(await _service.GetForCustomerAsync(customerId, cancellationToken));

    /// <summary>
    /// Producers whose certification status has changed and has not returned to Certified.
    /// </summary>
    /// <remarks>
    /// Feeds the Actionable Insights alert, which computes client-side over preloaded data and
    /// makes no per-customer calls — so it needs the whole flagged set in one read. The set is
    /// small by construction: only certifications that have actually moved.
    ///
    /// One NOP id can cover several customer records, so one changed certification can appear as
    /// several rows. That is intended; each affected producer needs its own alert.
    ///
    /// Not filtered by trade unit. Insights already scopes its own view by the selected trade
    /// units through the contracts it matches against, so filtering here as well would be a second
    /// place to get it wrong.
    /// </remarks>
    [HttpGet("status-changes")]
    [ProducesResponseType(typeof(IReadOnlyList<OrganicCertificationStatusChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<OrganicCertificationStatusChangeResponse>>> GetStatusChanges(
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetUnresolvedStatusChangesAsync(cancellationToken));

    // -------------------------------------------------------------------------
    /// <summary>
    /// Producers holding a NOP id that no certification has ever arrived for.
    /// </summary>
    /// <remarks>
    /// The two halves come from different pipelines: the NOP id from Profisee via the nightly
    /// customer sync, the certification from the integration team's feed. A producer listed here is
    /// one the master data calls organic and the feed has never confirmed.
    ///
    /// ⚠️ Only meaningful once that feed is running. Until it is, every organic producer qualifies
    /// — roughly 580 — so the Insights category this backs is gated behind an environment flag
    /// rather than shipped on.
    ///
    /// Not trade-unit filtered, for the same reason as status-changes: Insights scopes its own view
    /// through the customers it iterates, and filtering twice is a second place to get it wrong.
    /// </remarks>
    [HttpGet("missing-certificates")]
    [ProducesResponseType(typeof(IReadOnlyList<OrganicMissingCertificateResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<OrganicMissingCertificateResponse>>> GetMissingCertificates(
        CancellationToken cancellationToken = default)
        => Ok(await _service.GetMissingCertificatesAsync(cancellationToken));
}
