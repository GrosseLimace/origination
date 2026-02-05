using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

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
    public ActionResult<List<Contract>> GetAll()
    {
        return Ok(_dataService.GetContracts());
    }

    [HttpGet("customer/{customerId:long}")]
    public ActionResult<List<Contract>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetContractsByCustomer(customerId));
    }

    [HttpGet("farm/{farmId}")]
    public ActionResult<List<Contract>> GetByFarm(string farmId)
    {
        return Ok(_dataService.GetContractsByFarm(farmId));
    }
}
