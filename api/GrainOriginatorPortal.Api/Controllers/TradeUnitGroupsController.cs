using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class TradeUnitGroupsController : ControllerBase
{
    private readonly IDataService _dataService;

    public TradeUnitGroupsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public async Task<ActionResult<List<TradeUnitGroup>>> GetAll()
    {
        return Ok(await _dataService.GetTradeUnitGroups());
    }
}
