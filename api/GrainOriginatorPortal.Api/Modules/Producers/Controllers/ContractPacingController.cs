// Project namespaces
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Modules.Producers.Controllers;

/// <summary>
/// Contract Pacing, the producer view comparing this year's contracting with earlier years. Its route stays
/// under <c>api/contracts</c>, where it began, so the client doesn't change; the contracts themselves are read
/// through the Contracts service.
/// </summary>
[ApiController]
[Route("api/contracts")]
[RequirePermission(AppPermissions.Producers.ContractPacingRead)]
[Produces("application/json")]
// A failed CTRM read must not reach the browser as an empty list - see SurfaceCtrmFailuresAttribute.
[SurfaceCtrmFailures]
public class ContractPacingController : ControllerBase
{
    private readonly IContractService _contracts;

    public ContractPacingController(IContractService contracts)
    {
        _contracts = contracts;
    }

    /// <summary>Gets historical closed contracts for a customer, used by Contract Pacing year-over-year comparison.
    /// Queries base.Contract (not vw_CurrentContracts) to retrieve prior-year closed contracts.
    /// Open to anyone holding contract-pacing:read — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("pacing/{customerId:long}")]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetPacingHistorical(long customerId, CancellationToken cancellationToken = default)
    {
        // No per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        // Same cross-trade-unit dependency as ContractsController.GetByCustomer — see the note there before
        // adding an entitlement check here (H-069, 2026-09-21).
        return Ok(await _contracts.GetHistoricalForPacingAsync(customerId, cancellationToken));
    }
}
