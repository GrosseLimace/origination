using GrainOriginatorPortal.Api.Authorization;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Ingestion endpoint for the NOP organic certification feed — the front door the integration
/// calls.
///
/// The integration resolves NOP id to certification data from Profisee and USDA INTEGRITY and
/// forwards one message per producer here. It has no database access of its own, which keeps this
/// application the only writer to its own database. The contract handed to that team lives at
/// docs/application-context/Organic Certification Ingestion API Contract.md.
///
/// Callers are machine identities with no user context, so nothing on this path consults
/// trade-unit entitlements. That is deliberate and is not a missing authorization check: the
/// <see cref="OrganicIngestAccess.PolicyName"/> policy requires the Origination.Application app
/// role (or Admin, so the feed can be re-run by hand), and there is no user whose entitlements
/// could be consulted.
///
/// Safe to retry. The operation upserts on NOP id and its children are replaced as a set, so a
/// failed run can simply be run again.
/// </summary>
[ApiController]
[Route("api/organic-certifications")]
[Authorize(Policy = OrganicIngestAccess.PolicyName)]
[Produces("application/json")]
public class OrganicCertificationIngestController : ControllerBase
{
    private readonly IOrganicCertificationIngestService _service;

    public OrganicCertificationIngestController(IOrganicCertificationIngestService service)
    {
        _service = service ?? throw new ArgumentNullException(nameof(service));
    }

    /// <summary>
    /// Files one producer's organic certification.
    /// </summary>
    /// <remarks>
    /// POST one operation with its scopes and items. Fields the application does not model are
    /// ignored rather than rejected, so the sender can add to the payload without waiting on a
    /// deployment here.
    ///
    /// A NOP id whose scoularId matches no producer is still stored, and reported back with
    /// <c>customerMatched: false</c> — that is an onboarding gap, not a failure, and the record
    /// appears automatically once the producer exists. A malformed scope or item is dropped and
    /// named in <c>rejections</c> while the rest of the certification stores.
    ///
    /// On a 403, read the response headers before raising anything: an <c>x-ms-forbidden-ip</c>
    /// header with an HTML body means the request never reached this application and the problem
    /// is the network path, whereas our own headers (<c>X-Correlation-Id</c>, a CSP header) mean it
    /// arrived and the app-role grant is what is missing.
    /// </remarks>
    [HttpPost("ingest")]
    [ProducesResponseType(typeof(OrganicCertificationIngestResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<OrganicCertificationIngestResponse>> Ingest(
        [FromBody] OrganicCertificationIngestRequest request,
        CancellationToken cancellationToken = default)
        => Ok(await _service.IngestAsync(request, cancellationToken));

    /// <summary>
    /// Records a producer the sender considered but deliberately did not send a certification for.
    /// </summary>
    /// <remarks>
    /// The run total counts every producer CONSIDERED, not the ones sent, because the sender only
    /// learns mid-run that a producer has no USDA record. A skip notice fills that producer's
    /// position, so "we hold runTotal distinct positions" means the run finished — while a message
    /// genuinely lost in transit still leaves a gap. Without this the two are indistinguishable,
    /// which is what prevents acting on absence at all.
    ///
    /// Separate from <see cref="Ingest"/> rather than a flag on it because a skip reason of
    /// INELIGIBLE_NOP means the NOP id is blank or a placeholder — which ingest rejects outright as
    /// MISSING_NOP_OPERATION_ID, the one failure that loses a whole message.
    ///
    /// Stores no certification, and never alters one that already exists.
    ///
    /// Safe to retry: a repeat writes another audit row, and completeness counts distinct positions
    /// rather than rows.
    /// </remarks>
    [HttpPost("skip")]
    [ProducesResponseType(typeof(OrganicCertificationSkipResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<OrganicCertificationSkipResponse>> Skip(
        [FromBody] OrganicCertificationSkipRequest request,
        CancellationToken cancellationToken = default)
        => Ok(await _service.RecordSkipAsync(request, cancellationToken));
}
