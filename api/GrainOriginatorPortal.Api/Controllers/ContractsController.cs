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
    public ActionResult<List<Contract>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(_dataService.GetContracts(tradeUnits));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific customer.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public ActionResult<List<Contract>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetContractsByCustomer(customerId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all contracts for a specific farm.</summary>
    [HttpGet("farm/{farmId}")]
    [ProducesResponseType(typeof(List<Contract>), StatusCodes.Status200OK)]
    public ActionResult<List<Contract>> GetByFarm(string farmId)
    {
        return Ok(_dataService.GetContractsByFarm(farmId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets pricing lines for a specific contract by its sourceContractId.</summary>
    [HttpGet("pricing-lines")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<List<ContractPricingLine>> GetPricingLines([FromQuery] string sourceContractId)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
        {
            return BadRequest("sourceContractId is required");
        }
        return Ok(_dataService.GetPricingLines(sourceContractId));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all pricing lines for a customer's contracts by sourceCustomerId.</summary>
    [HttpGet("pricing-lines/by-customer")]
    [ProducesResponseType(typeof(List<ContractPricingLine>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public ActionResult<List<ContractPricingLine>> GetPricingLinesByCustomer([FromQuery] string sourceCustomerId)
    {
        if (string.IsNullOrWhiteSpace(sourceCustomerId))
        {
            return BadRequest("sourceCustomerId is required");
        }
        return Ok(_dataService.GetPricingLinesByCustomer(sourceCustomerId));
    }
}
