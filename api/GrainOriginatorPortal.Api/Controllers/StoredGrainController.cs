using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
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
    public async Task<ActionResult<List<StoredGrain>>> GetAll()
    {
        return Ok(await _dataService.GetStoredGrain());
    }

    [HttpGet("customer/{customerId:long}")]
    public async Task<ActionResult<List<StoredGrain>>> GetByCustomer(long customerId)
    {
        return Ok(await _dataService.GetStoredGrainByCustomer(customerId));
    }
}
