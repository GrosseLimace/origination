using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class NotesController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<NotesController> _logger;

    public NotesController(IDataService dataService, ILogger<NotesController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public ActionResult<List<Note>> GetAll()
    {
        return Ok(_dataService.GetNotes());
    }

    [HttpGet("customer/{customerId:long}")]
    public ActionResult<List<Note>> GetByCustomer(long customerId)
    {
        return Ok(_dataService.GetNotesByCustomer(customerId));
    }

    [HttpPost]
    public ActionResult<Note> Create([FromBody] CreateNoteRequest request)
    {
        try
        {
            var note = _dataService.AddNote(request.CustomerId, request.Content, request.TradeUnit);
            return Created($"/api/notes/{note.Id}", note);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("database permissions"))
        {
            return StatusCode(503, new { error = "Service temporarily unavailable" });
        }
    }

    [HttpPut("{id:long}/toggle-pin")]
    public ActionResult<Note> TogglePin(long id)
    {
        var note = _dataService.ToggleNotePin(id);
        if (note == null)
        {
            return NotFound();
        }
        return Ok(note);
    }

    [HttpPut("{id:long}")]
    public ActionResult<Note> Update(long id, [FromBody] UpdateNoteRequest request)
    {
        var note = _dataService.UpdateNote(id, request.Content);
        if (note == null)
        {
            return NotFound();
        }
        return Ok(note);
    }

    [HttpDelete("{id:long}")]
    public ActionResult Delete(long id)
    {
        try
        {
            _dataService.DeleteNote(id);
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting note {Id}", id);
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }
}

public class CreateNoteRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    public long CustomerId { get; set; }

    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(2000)]
    public string Content { get; set; } = string.Empty;

    public string? TradeUnit { get; set; }
}

public class UpdateNoteRequest
{
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(2000)]
    public string Content { get; set; } = string.Empty;
}
