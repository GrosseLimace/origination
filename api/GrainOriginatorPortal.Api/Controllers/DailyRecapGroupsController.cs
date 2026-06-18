// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// CRUD for Daily Recap groups (Daily Digest). Create/update/delete/toggle are creator-owned. The
/// list (GetAll) also returns groups the caller is a member of (read-only on the client). The
/// external Logic App reads the underlying tables directly and re-resolves trade-unit / group
/// members against entitlements at send time.
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
    /// <summary>Gets the recap groups the caller created (editable) plus ones they're a member of
    /// (read-only). Membership is matched against the caller's trade-unit / group entitlements.</summary>
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
    public async Task<ActionResult<RecapGroupDto>> Create([FromBody] RecapGroupRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _service.CreateAsync(request, cancellationToken);
        _logger.LogInformation(
            "Recap group created [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Name={Name}",
            "AUDIT_CREATE", "DataMutation", group.Id, request.Name);
        return Created($"/api/dailyrecapgroups/{group.Id}", group);
    }

    // -------------------------------------------------------------------------
    /// <summary>Updates an existing recap group by ID.</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecapGroupDto>> Update(int id, [FromBody] RecapGroupRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.UpdateAsync(id, request, cancellationToken)
            ?? throw new NotFoundException("DailyRecapGroup", id);
        _logger.LogInformation(
            "Recap group updated [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Name={Name}",
            "AUDIT_UPDATE", "DataMutation", id, request.Name);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Toggles a recap group's enabled flag.</summary>
    [HttpPut("{id:int}/enabled")]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecapGroupDto>> SetEnabled(int id, [FromBody] RecapGroupEnabledRequest request, CancellationToken cancellationToken = default)
    {
        var updated = await _service.SetEnabledAsync(id, request.Enabled, cancellationToken)
            ?? throw new NotFoundException("DailyRecapGroup", id);
        _logger.LogInformation(
            "Recap group enabled toggled [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}, Enabled={Enabled}",
            "AUDIT_UPDATE", "DataMutation", id, request.Enabled);
        return Ok(updated);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes a recap group by ID (cascade removes members + CC emails).</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        await _service.DeleteAsync(id, cancellationToken);
        _logger.LogInformation(
            "Recap group deleted [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
