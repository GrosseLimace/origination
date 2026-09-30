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
    /// <summary>Manager-only: all saved lists created by other users whose trade units overlap the
    /// requested CSV. Gated by the same "Admin" role that gates the Usage Dashboard.</summary>
    [HttpGet("team")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(typeof(List<SavedListResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<SavedListResponse>>> GetTeam([FromQuery] string? tradeUnits, CancellationToken cancellationToken = default)
    {
        // The tradeUnits CSV is NOT trusted, despite how this line reads. SavedListService
        // .GetTeamListsAsync calls ScopeToAllowedTradeUnitsAsync, which intersects the request with
        // IUserEntitlementService.GetAllowedTradeUnitCodesAsync for the caller and returns an empty
        // list when nothing survives - exactly the "derive from identity and intersect" remedy a
        // scanner asks for here. Flagged as Broken Access Control by the QA scan on 2026-09-30
        // (CWE-285) because the review read this controller and stopped; the scoping is one layer
        // down. Do not "fix" it twice. Disposition recorded in SECURITY-REVIEWS/ACCEPTED-RISKS.md.
        return Ok(await _service.GetTeamListsAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Manager-only: team members in the requested trade units (for the "assign a list" picker).</summary>
    [HttpGet("team-members")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(typeof(List<TeamMemberResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TeamMemberResponse>>> GetTeamMembers([FromQuery] string? tradeUnits, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetTeamMembersAsync(tradeUnits, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Manager-only: assigns a copy of a built list to one or more team members.</summary>
    [HttpPost("assign")]
    [Authorize(Policy = "AdminOnly")]
    [ProducesResponseType(typeof(List<SavedListResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<List<SavedListResponse>>> Assign([FromBody] AssignSavedListRequest request, CancellationToken cancellationToken = default)
    {
        var created = await _service.AssignAsync(request.TargetUserIds, request.Name, request.Query, request.TradeUnits,
            request.Filters, request.IncludedCustomerIds, request.ExcludedCustomerIds, cancellationToken);
        _logger.LogInformation(
            "Saved list assigned [{ErrorCode}] [{ErrorCategory}]: Name={Name}, Targets={TargetCount}, Created={CreatedCount}",
            "AUDIT_CREATE", "DataMutation", request.Name, request.TargetUserIds.Count, created.Count);
        return Ok(created);
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
