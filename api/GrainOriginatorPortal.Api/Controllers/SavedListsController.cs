using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class SavedListsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<SavedListsController> _logger;

    public SavedListsController(IDataService dataService, ILogger<SavedListsController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<SavedList>>> GetAll()
    {
        return Ok(await _dataService.GetSavedLists());
    }

    [HttpPost]
    public async Task<ActionResult<SavedList>> Create([FromBody] CreateSavedListRequest request)
    {
        var savedList = await _dataService.SaveList(request.Name, request.Query, request.TradeUnits, request.Filters);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<SavedList>> Update(int id, [FromBody] CreateSavedListRequest request)
    {
        var updated = await _dataService.UpdateList(id, request.Name, request.Query, request.TradeUnits, request.Filters);
        if (updated == null) return NotFound();
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        try
        {
            await _dataService.DeleteList(id);
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting saved list {Id}", id);
            return StatusCode(500, new { error = "An unexpected error occurred." });
        }
    }
}

public class CreateSavedListRequest
{
    [Required]
    [StringLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [StringLength(500)]
    public string Query { get; set; } = string.Empty;

    [StringLength(500)]
    public string? TradeUnits { get; set; } // Comma-separated trade unit keys

    public string? Filters { get; set; }    // JSON-serialized RefinementFilters (nullable)
}
