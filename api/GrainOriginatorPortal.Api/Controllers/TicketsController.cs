using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class TicketsController : ControllerBase
{
    private readonly IDataService _dataService;

    public TicketsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<Ticket>> GetAll([FromQuery] List<string>? tradeUnits = null)
    {
        return Ok(_dataService.GetTickets(tradeUnits));
    }

    [HttpGet("customer/{customerId:long}")]
    public ActionResult<List<Ticket>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetTicketsByCustomer(customerId));
    }

    [HttpGet("farm/{farmId}")]
    public ActionResult<List<Ticket>> GetByFarm(string farmId)
    {
        return Ok(_dataService.GetTicketsByFarm(farmId));
    }
}
