// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
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
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetAll([FromQuery] List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByCustomerAsync(customerId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<Contract>>> GetByFarm(string farmId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetContractsByFarmAsync(farmId, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets pricing lines for a specific contract by its sourceContractId.</summary>
    [HttpGet("pricing-lines")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLines([FromQuery] string sourceContractId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
        {
            throw new ValidationException("sourceContractId", "sourceContractId is required.");
        }
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
