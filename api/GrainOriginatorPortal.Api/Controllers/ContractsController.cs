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
    private readonly IUserEntitlementService _entitlementService;

    public ContractsController(IDataService dataService, IUserEntitlementService entitlementService)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
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
    public async Task<ActionResult<List<Contract>>> GetByCustomer(long customerId, [FromQuery] string? sourceCustomerId = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByCustomerAsync(customerId, sourceCustomerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets historical closed contracts for a customer, used by Contract Pacing year-over-year comparison.
    /// Queries base.Contract (not vw_CurrentContracts) to retrieve prior-year closed contracts.</summary>
    [HttpGet("pacing/{customerId:long}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetPacingHistorical(long customerId, CancellationToken cancellationToken = default)
    {
        await _entitlementService.ValidateCustomerAccessAsync(customerId, cancellationToken);
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
    /// <summary>Gets all contracts for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        var contracts = await _dataService.GetContractsByFarmAsync(farmId, cancellationToken);
        var tradeUnits = contracts.Select(c => c.TradeUnit).Where(t => t is not null).Distinct().ToList();
        if (tradeUnits.Count > 0)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits!, cancellationToken);
        return Ok(contracts);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets pricing lines for a specific contract by its sourceContractId.</summary>
    [HttpGet("pricing-lines")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLines([FromQuery] string sourceContractId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
            throw new ValidationException("sourceContractId", "sourceContractId is required.");

        // Resolve the contract's trade unit and validate access before returning pricing data
        var contracts = await _dataService.GetContractsBySourceIdAsync(sourceContractId, cancellationToken);
        var tradeUnits = contracts.Select(c => c.TradeUnit).Where(t => t is not null).Distinct().ToList();
        if (tradeUnits.Count > 0)
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(tradeUnits!, cancellationToken);

        return Ok(await _dataService.GetPricingLinesAsync(sourceContractId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all pricing lines for a customer's contracts by sourceCustomerId.</summary>
    [HttpGet("pricing-lines/by-customer")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLinesByCustomer([FromQuery] string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceCustomerId))
        {
            throw new ValidationException("sourceCustomerId", "sourceCustomerId is required.");
        }
        return Ok(await _dataService.GetPricingLinesByCustomerAsync(sourceCustomerId, cancellationToken));
    }
}
