using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StoredGrainController : ControllerBase
{
    private readonly IDataService _dataService;

    public StoredGrainController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<StoredGrain>> GetAll()
    {
        return Ok(_dataService.GetStoredGrain());
    }

    [HttpGet("customer/{customerId:long}")]
    public ActionResult<List<StoredGrain>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetStoredGrainByCustomer(customerId));
    }
}
