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
