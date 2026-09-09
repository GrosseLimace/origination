// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
// A failed CTRM read must not reach the browser as an empty list - see SurfaceCtrmFailuresAttribute.
[SurfaceCtrmFailures]
public class ContractsController : ControllerBase
{
    private readonly IContractService _service;

    public ContractsController(IContractService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetByCustomer(long customerId, [FromQuery] string? scoularId = null, CancellationToken cancellationToken = default)
    {
        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetByCustomerAsync(customerId, scoularId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets historical closed contracts for a customer, used by Contract Pacing year-over-year comparison.
    /// Queries base.Contract (not vw_CurrentContracts) to retrieve prior-year closed contracts.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("pacing/{customerId:long}")]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetPacingHistorical(long customerId, CancellationToken cancellationToken = default)
    {
        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetHistoricalForPacingAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets ALL purchase contracts (open + closed) for a specific crop year from base.Contract,
    /// scoped to the user's selected trade units. Used by the Planting Intentions Dashboard's
    /// Harvest &amp; Contracts tab so older planting years still show closed historical contracts.</summary>
    [HttpGet("by-crop-year/{cropYear:int}")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetByCropYear(int cropYear, [FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCropYearAsync(cropYear, tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific farm. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<ContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ContractResponse>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        // Open to any rep — no per-farm object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetByFarmAsync(farmId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets pricing lines for a specific contract by its sourceContractId.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("pricing-lines")]
    [ProducesResponseType(typeof(List<ContractPricingLineResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLineResponse>>> GetPricingLines([FromQuery] string sourceContractId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
            throw new ValidationException("sourceContractId", "sourceContractId is required.");

        // Open to any rep — no per-contract object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetPricingLinesAsync(sourceContractId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all pricing lines for a customer's contracts by scoularId.</summary>
    [HttpGet("pricing-lines/by-customer")]
    [ProducesResponseType(typeof(List<ContractPricingLineResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLineResponse>>> GetPricingLinesByCustomer([FromQuery] string scoularId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(scoularId))
        {
            throw new ValidationException("scoularId", "scoularId is required.");
        }

        // Open to any rep — no per-producer object-level authz by design; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02).
        return Ok(await _service.GetPricingLinesByCustomerAsync(scoularId, cancellationToken));
    }
}
