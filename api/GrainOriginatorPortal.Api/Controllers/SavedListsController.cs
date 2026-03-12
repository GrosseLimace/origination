// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class SavedListsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ILogger<SavedListsController> _logger;

    public SavedListsController(IDataService dataService, IUserEntitlementService entitlementService, ILogger<SavedListsController> logger)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all saved customer lists.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<SavedList>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<SavedList>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetSavedListsAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new saved customer list.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<SavedList>> Create([FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        await ValidateTradeUnitsInRequest(request.TradeUnits, cancellationToken);
        var savedList = await _dataService.SaveListAsync(request.Name, request.Query, request.TradeUnits, request.Filters, cancellationToken);
        _logger.LogInformation(
            "Saved list created [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}, Name={Name}",
            "AUDIT_CREATE", "DataMutation", savedList.Id, request.Name);
        return Created($"/api/savedlists/{savedList.Id}", savedList);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing saved list by ID.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(SavedList), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SavedList>> Update(int id, [FromBody] CreateSavedListRequest request, CancellationToken cancellationToken = default)
    {
        await ValidateTradeUnitsInRequest(request.TradeUnits, cancellationToken);
        var updated = await _dataService.UpdateListAsync(id, request.Name, request.Query, request.TradeUnits, request.Filters, cancellationToken)
            ?? throw new NotFoundException("SavedList", id);
        _logger.LogInformation(
            "Saved list updated [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}, Name={Name}",
            "AUDIT_UPDATE", "DataMutation", id, request.Name);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a saved list by ID.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _dataService.DeleteListAsync(id, cancellationToken);
        _logger.LogInformation(
            "Saved list deleted [{ErrorCode}] [{ErrorCategory}]: ListId={ListId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }

    // -------------------------------------------------------------------------
    private async Task ValidateTradeUnitsInRequest(string? tradeUnits, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tradeUnits))
            return;

        var codes = tradeUnits.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (codes.Length > 0)
        {
            await _entitlementService.ValidateTradeUnitsOrThrowAsync(codes, ct);
        }
    }
}
