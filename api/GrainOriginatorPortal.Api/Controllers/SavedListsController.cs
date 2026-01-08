using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Mvc;

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
    public ActionResult Create([FromBody] CreateSavedListRequest request)
    {
        _dataService.SaveList(request.Name, request.Query, request.CustomerIds);
        return Created();
    }

    [HttpDelete("{id}")]
    public ActionResult Delete(string id)
    {
        _dataService.DeleteList(id);
        return NoContent();
    }
}

public class CreateSavedListRequest
{
    public string Name { get; set; } = string.Empty;
    public string Query { get; set; } = string.Empty;
    public List<string> CustomerIds { get; set; } = new();
}
