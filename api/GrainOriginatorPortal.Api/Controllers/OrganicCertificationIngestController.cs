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
}
