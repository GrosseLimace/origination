using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

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
    public ActionResult<List<Ticket>> GetAll()
    {
        return Ok(_dataService.GetTickets());
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
