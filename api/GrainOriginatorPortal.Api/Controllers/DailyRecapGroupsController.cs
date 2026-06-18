// Project namespaces
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// CRUD for Daily Recap groups (Daily Digest). Create/update/delete are creator-owned. The list
/// (GetAll) also returns groups the caller is a member of (read-only on the client). The external
/// Logic App reads the underlying tables directly and re-resolves trade-unit / group members
/// against entitlements at send time.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class DailyRecapGroupsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly ILogger<DailyRecapGroupsController> _logger;

    public DailyRecapGroupsController(IDataService dataService, EntitlementsDbContext entitlementsDb, ILogger<DailyRecapGroupsController> logger)
    {
        _dataService = dataService;
        _entitlementsDb = entitlementsDb;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the recap groups the caller created (editable) plus ones they're a member of
    /// (read-only). Membership is matched against the caller's trade-unit / group entitlements.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<RecapGroupDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<RecapGroupDto>>> GetAll(CancellationToken cancellationToken = default)
    {
        // Resolve the caller's entitlements so the service can include groups they're a MEMBER of
        // (by trade unit or trade-unit group), not just ones they created. Member ids mirror the
        // Daily Digest picker: trade-unit = TU code, trade-unit-group = entitlements GroupId (string).
        var upn = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("upn")?.Value
            ?? User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? User.Identity?.Name
            ?? string.Empty;
        var userId = upn.Contains('@') ? upn.Split('@')[0] : upn;

        var tuCodes = new List<string>();
        var groupIds = new List<string>();
        if (!string.IsNullOrWhiteSpace(userId))
        {
            try
            {
                var rows = await _entitlementsDb.UserTradeUnitAccess
                    .Where(u => u.UserId == userId)
                    .Select(u => new { u.TradeUnitCode, u.GroupId })
                    .ToListAsync(cancellationToken);
                tuCodes = rows.Where(r => !string.IsNullOrWhiteSpace(r.TradeUnitCode)).Select(r => r.TradeUnitCode).Distinct().ToList();
                groupIds = rows.Where(r => r.GroupId != null).Select(r => r.GroupId!.Value.ToString()).Distinct().ToList();
            }
            catch (Exception ex)
            {
                // Entitlements unavailable → fall back to creator-owned groups only (empty member sets).
                _logger.LogWarning(ex, "Entitlements unavailable for {UserId} — recap group list limited to owned groups", userId);
            }
        }

        return Ok(await _dataService.GetRecapGroupsAsync(tuCodes, groupIds, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates a new recap group.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(RecapGroupDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<RecapGroupDto>> Create([FromBody] RecapGroupRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _dataService.CreateRecapGroupAsync(request, cancellationToken);
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
        var updated = await _dataService.UpdateRecapGroupAsync(id, request, cancellationToken)
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
        var updated = await _dataService.SetRecapGroupEnabledAsync(id, request.Enabled, cancellationToken)
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
        await _dataService.DeleteRecapGroupAsync(id, cancellationToken);
        _logger.LogInformation(
            "Recap group deleted [{ErrorCode}] [{ErrorCategory}]: GroupId={GroupId}",
            "AUDIT_DELETE", "DataMutation", id);
        return NoContent();
    }
}
