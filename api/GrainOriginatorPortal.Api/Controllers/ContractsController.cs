using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class ContractsController : ControllerBase
{
    private readonly IDataService _dataService;

    public ContractsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public async Task<ActionResult<List<Contract>>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(await _dataService.GetContracts(tradeUnits));
    }

    [HttpGet("customer/{customerId:long}")]
    public async Task<ActionResult<List<Contract>>> GetByCustomer(long customerId)
    {
        return Ok(await _dataService.GetContractsByCustomer(customerId));
    }

    [HttpGet("farm/{farmId}")]
    public async Task<ActionResult<List<Contract>>> GetByFarm(string farmId)
    {
        return Ok(await _dataService.GetContractsByFarm(farmId));
    }

    [HttpGet("pricing-lines")]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLines([FromQuery] string sourceContractId)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId))
            return BadRequest("sourceContractId is required");

        return Ok(await _dataService.GetPricingLines(sourceContractId));
    }

    [HttpGet("pricing-lines/by-customer")]
    public async Task<ActionResult<List<ContractPricingLine>>> GetPricingLinesByCustomer([FromQuery] string sourceCustomerId)
    {
        if (string.IsNullOrWhiteSpace(sourceCustomerId))
            return BadRequest("sourceCustomerId is required");

        return Ok(await _dataService.GetPricingLinesByCustomer(sourceCustomerId));
    }
}
