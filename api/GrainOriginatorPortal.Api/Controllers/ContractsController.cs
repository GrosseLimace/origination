// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Filters;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class ContractsController : ControllerBase
{
    private readonly IDataService _dataService;

    public ContractsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts, optionally filtered by trade units.</summary>
    [HttpGet]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByCustomer(long customerId, [FromQuery] string? scoularId = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByCustomerAsync(customerId, scoularId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets historical closed contracts for a customer, used by Contract Pacing year-over-year comparison.
    /// Queries base.Contract (not vw_CurrentContracts) to retrieve prior-year closed contracts.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("pacing/{customerId:long}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetPacingHistorical(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetHistoricalContractsForPacingAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets ALL purchase contracts (open + closed) for a specific crop year from base.Contract,
    /// scoped to the user's selected trade units. Used by the Planting Intentions Dashboard's
    /// Harvest &amp; Contracts tab so older planting years still show closed historical contracts.</summary>
    [HttpGet("by-crop-year/{cropYear:int}")]
    [EnforceTradeUnitAccess]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByCropYear(int cropYear, [FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByCropYearAsync(cropYear, tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific farm. Open to any authenticated originator —
    /// trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByFarmAsync(farmId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets pricing lines for a specific contract by its sourceContractId.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("pricing-lines")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLines([FromQuery] string sourceContractId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
            throw new ValidationException("sourceContractId", "sourceContractId is required.");

        return Ok(await _dataService.GetPricingLinesAsync(sourceContractId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all pricing lines for a customer's contracts by scoularId.</summary>
    [HttpGet("pricing-lines/by-customer")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLinesByCustomer([FromQuery] string scoularId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(scoularId))
        {
            throw new ValidationException("scoularId", "scoularId is required.");
        }
        return Ok(await _dataService.GetPricingLinesByCustomerAsync(scoularId, cancellationToken));
    }
}
