// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// CRUD for Daily Recap groups (Daily Digest). Edit rights equal visibility: anyone who can see a
/// group — its creator, or a member directly or via a trade unit / trade-unit group — can update it
/// and toggle its recap. DELETE is creator-only. The list (GetAll) returns exactly the groups the
/// caller may edit. The external Logic App reads the underlying tables directly and re-resolves
/// trade-unit / group members against entitlements at send time.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class DailyRecapGroupsController : ControllerBase
{
    private readonly IDailyRecapGroupService _service;
    private readonly ILogger<DailyRecapGroupsController> _logger;

    public DailyRecapGroupsController(IDailyRecapGroupService service, ILogger<DailyRecapGroupsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the recap groups the caller may edit — ones they created plus ones they are a
    /// member of. Membership is matched against the caller's trade-unit / group entitlements.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<RecapGroupDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<RecapGroupDto>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new recap group.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<RecapGroupDto>> Create([FromBody] RecapGroupRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _service.CreateAsync(request, cancellationToken);
        _logger.LogInformation(
            "Recap group created [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Name={Name}, DeliveryMethod={DeliveryMethod}, TeamsChannel={TeamsChannel}, MentionsToChannel={MentionsToChannel}",
            "AUDIT_CREATE", "DataMutation", group.Id, request.Name, group.DeliveryMethod, group.TeamsChannelEmail ?? "-", group.MentionsToChannel);
        return Created($"/api/dailyrecapgroups/{group.Id}", group);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing recap group by ID. Any member may edit, not just the creator, so
    /// the audit line records whether the editor was the creator.</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecapGroupDto>> Update(int id, [FromBody] RecapGroupRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.UpdateAsync(id, request, cancellationToken)
            ?? throw new NotFoundException("DailyRecapGroup", id);
        _logger.LogInformation(
            "Recap group updated [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Name={Name}, ByCreator={ByCreator}, DeliveryMethod={DeliveryMethod}, TeamsChannel={TeamsChannel}, MentionsToChannel={MentionsToChannel}",
            "AUDIT_UPDATE", "DataMutation", id, request.Name, updated.IsOwner, updated.DeliveryMethod, updated.TeamsChannelEmail ?? "-", updated.MentionsToChannel);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Toggles a recap group's enabled flag. Any member may toggle, so the audit line
    /// records whether the actor was the creator — flipping this starts or stops a daily email to
    /// everyone in the group.</summary>
    [HttpPut("{id:int}/enabled")]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecapGroupDto>> SetEnabled(int id, [FromBody] RecapGroupEnabledRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.SetEnabledAsync(id, request.Enabled, cancellationToken)
            ?? throw new NotFoundException("DailyRecapGroup", id);
        _logger.LogInformation(
            "Recap group enabled toggled [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Enabled={Enabled}, ByCreator={ByCreator}",
            "AUDIT_UPDATE", "DataMutation", id, request.Enabled, updated.IsOwner);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a recap group by ID (cascade removes members + CC emails). Creator-only —
    /// the service throws 403 for a member and 404 when the group does not exist, so the audit line
    /// below is only reachable on a delete that actually happened.</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _service.DeleteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Recap group deleted [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
