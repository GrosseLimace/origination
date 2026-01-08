using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotesController : ControllerBase
{
    private readonly IDataService _dataService;

    public NotesController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<Note>> GetAll()
    {
        return Ok(_dataService.GetNotes());
    }

    [HttpGet("customer/{customerId}")]
    public ActionResult<List<Note>> GetByCustomer(string customerId)
    {
        return Ok(_dataService.GetNotesByCustomer(customerId));
    }

    [HttpPost]
    public ActionResult Create([FromBody] CreateNoteRequest request)
    {
        _dataService.AddNote(request.CustomerId, request.FarmId, request.OriginatorName, request.Content);
        return Created();
    }

    [HttpPut("{id}/toggle-pin")]
    public ActionResult TogglePin(string id)
    {
        _dataService.ToggleNotePin(id);
        return NoContent();
    }
}

public class CreateNoteRequest
{
    public string CustomerId { get; set; } = string.Empty;
    public string? FarmId { get; set; }
    public string OriginatorName { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
}
