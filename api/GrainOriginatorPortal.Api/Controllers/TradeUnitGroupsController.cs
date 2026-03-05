using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

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
    public ActionResult<List<TradeUnitGroup>> GetAll()
    {
        return Ok(_dataService.GetTradeUnitGroups());
    }
}
