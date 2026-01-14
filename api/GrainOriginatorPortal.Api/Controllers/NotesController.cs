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
    public ActionResult<Note> Create([FromBody] CreateNoteRequest request)
    {
        var note = _dataService.AddNote(request.CustomerId, request.Content);
        return Created($"/api/notes/{note.Id}", note);
    }

    [HttpPut("{id}/toggle-pin")]
    public ActionResult<Note> TogglePin(string id)
    {
        var note = _dataService.ToggleNotePin(id);
        if (note == null)
        {
            return NotFound();
        }
        return Ok(note);
    }
}

public class CreateNoteRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(100)]
    public string CustomerId { get; set; } = string.Empty;

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(2000)]
    public string Content { get; set; } = string.Empty;
}
