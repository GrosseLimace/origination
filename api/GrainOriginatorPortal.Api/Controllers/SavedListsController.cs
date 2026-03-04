using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SavedListsController : ControllerBase
{
    private readonly IDataService _dataService;

    public SavedListsController(IDataService dataService)
    {
        _dataService = dataService;
    }

    [HttpGet]
    public ActionResult<List<SavedList>> GetAll()
    {
        return Ok(_dataService.GetSavedLists());
    }

    [HttpPost]
    public ActionResult<SavedList> Create([FromBody] CreateSavedListRequest request)
    {
        var savedList = _dataService.SaveList(request.Name, request.Query, request.TradeUnits, request.Filters);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    [HttpDelete("{id}")]
    public ActionResult Delete(int id)
    {
        _dataService.DeleteList(id);
        return NoContent();
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
