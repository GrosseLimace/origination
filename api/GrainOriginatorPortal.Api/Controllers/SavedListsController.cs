// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class SavedListsController : ControllerBase
{
    private readonly ISavedListService _service;
    private readonly ILogger<SavedListsController> _logger;

    public SavedListsController(ISavedListService service, ILogger<SavedListsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all saved customer lists.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<SavedListResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<SavedListResponse>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new saved customer list.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SavedListResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<SavedListResponse>> Create([FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        var savedList = await _service.CreateAsync(request.Name, request.Query, request.TradeUnits, request.Filters, request.IncludedCustomerIds, request.ExcludedCustomerIds, cancellationToken);
        _logger.LogInformation(
            "Saved list created [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}, Name={Name}",
            "AUDIT_CREATE", "DataMutation", savedList.Id, request.Name);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing saved list by ID.</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(SavedListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SavedListResponse>> Update(int id, [FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.UpdateAsync(id, request.Name, request.Query, request.TradeUnits, request.Filters, request.IncludedCustomerIds, request.ExcludedCustomerIds, cancellationToken)
            ?? throw new NotFoundException("SavedList", id);
        _logger.LogInformation(
            "Saved list updated [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}, Name={Name}",
            "AUDIT_UPDATE", "DataMutation", id, request.Name);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a saved list by ID.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _service.DeleteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Saved list deleted [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
