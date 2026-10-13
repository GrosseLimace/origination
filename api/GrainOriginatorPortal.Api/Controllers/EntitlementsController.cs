using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Read-only catalog of the entitlements directory — used by the Daily Digest
/// "Recap Group" picker to surface people, trade units, and trade-unit groups
/// the merchandiser can include as recipients. Backed by <c>vw_UserTradeUnitPreferences</c>
/// in the TradeUnitPreferences database (a flattened user × trade-unit × group join).
///
/// All three lists are returned in one response so the picker dialog can fetch
/// once when it opens.
/// </summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
public class EntitlementsController : ControllerBase
{
    private readonly IEntitlementsDirectoryService _directory;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<EntitlementsController> _logger;

    public EntitlementsController(
        IEntitlementsDirectoryService directory,
        IRequestContextService requestContext,
        ILogger<EntitlementsController> logger)
    {
        _directory = directory;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <summary>
    /// Returns the directory scoped to the current user's overlap:
    ///   - People = anyone who shares ≥1 trade unit with the caller
    ///   - Trade Units = trade units the caller is entitled to
    ///   - Groups = groups the caller is a member of
    ///
    /// Matches the Recap Group picker's mental model — "people I can include
    /// have to be in a trade unit I'm also in." Empty list on entitlements-DB
    /// outage, matching the fail-open behavior used elsewhere.
    /// </summary>
    [HttpGet("catalog")]
    public async Task<ActionResult<EntitlementsCatalogResponse>> GetCatalog(CancellationToken ct = default)
    {
        // UserTradeUnitPreference.UserId is the UPN prefix (e.g. "CEgr"), not the full UPN —
        // exactly what IRequestContextService.GetCurrentUserShortName resolves. This controller
        // reimplemented that claim chain inline, as did NotesController.GetMentionCatalog.
        var userId = _requestContext.GetCurrentUserShortName();
        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized("Unable to determine user identity from token.");

        try
        {
            // The caller's own rows drive which trade units and groups are expanded.
            var callerRows = await _directory.GetAssignmentsAsync(userId, ct);

            // Caller's own TUs — drives the People filter (must share a TU with caller).
            var callerTuCodes = callerRows
                .Select(r => r.TradeUnitCode)
                .Where(c => !string.IsNullOrWhiteSpace(c))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (callerTuCodes.Count == 0)
            {
                // User has no entitlements at all — return empty rather than surfacing
                // the org-wide directory.
                return Ok(new EntitlementsCatalogResponse());
            }

            var callerGroupIds = callerRows
                .Where(r => r.GroupId.HasValue)
                .Select(r => r.GroupId!.Value)
                .ToHashSet();

            // Only the rows relevant to the caller: anyone sharing one of their trade units, and every
            // row in their groups. Both reads filter in SQL, so memory is bounded by the caller's
            // overlap rather than by the size of the view. Not limited to active users: this catalog
            // has never checked the roster (the mention catalog does).
            var colleagueRows = await _directory.GetColleaguesAsync(callerTuCodes, activeOnly: false, ct);
            var groupRows = callerGroupIds.Count > 0
                ? await _directory.GetGroupAssignmentsAsync(callerGroupIds, ct)
                : [];

            // People who share ≥1 TU with the caller. The caller is INCLUDED so they can add
            // themselves as a recipient of a recap group (they're in their own trade units, so the
            // recap-group member validation already permits self).
            var people = colleagueRows
                .Where(r => callerTuCodes.Contains(r.TradeUnitCode))
                .Where(r => !string.IsNullOrWhiteSpace(r.UserId))
                .GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase)
                .Select(g => new EntitlementPerson
                {
                    UserId = g.Key,
                    DisplayName = g.First().DisplayName,
                    // UPN convention: <UserId>@scoular.com. Logic App resolves the
                    // authoritative address at send time.
                    Email = $"{g.Key}@scoular.com",
                    // Person's own TUs — lets the picker cascade-select people when a
                    // trade unit or group is chosen. Scoped to TUs the caller shares.
                    TradeUnitCodes = g.Select(r => r.TradeUnitCode)
                        .Where(c => !string.IsNullOrWhiteSpace(c) && callerTuCodes.Contains(c))
                        .Distinct()
                        .OrderBy(c => c)
                        .ToList(),
                })
                .OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Trade Units = the caller's own TUs (deduped + ordered).
            var tradeUnits = colleagueRows
                .Where(r => callerTuCodes.Contains(r.TradeUnitCode))
                .GroupBy(r => r.TradeUnitCode, StringComparer.OrdinalIgnoreCase)
                .Select(g => new EntitlementTradeUnit
                {
                    Code = g.Key,
                    Description = g.First().Description,
                })
                .OrderBy(t => t.Code, StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Groups the caller is a member of (callerGroupIds computed above from the caller's rows).
            // Each group lists its TUs so the Logic App can expand it the same way the entitlements layer does.
            var groups = groupRows
                .Where(r => r.GroupId.HasValue && callerGroupIds.Contains(r.GroupId!.Value))
                .Where(r => !string.IsNullOrWhiteSpace(r.GroupName))
                .GroupBy(r => r.GroupId!.Value)
                .Select(g => new EntitlementTradeUnitGroup
                {
                    GroupId = g.Key,
                    Name = g.First().GroupName!,
                    TradeUnitCodes = g.Select(r => r.TradeUnitCode).Distinct().OrderBy(c => c).ToList(),
                })
                .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Ok(new EntitlementsCatalogResponse
            {
                People = people,
                TradeUnits = tradeUnits,
                Groups = groups,
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements catalog unavailable for {UserId} — returning empty lists", userId);
            return Ok(new EntitlementsCatalogResponse { Degraded = true });
        }
    }
}

public class EntitlementsCatalogResponse
{
    /// <summary>
    /// True when the catalog could not be read and the lists below are empty because of that, not
    /// because the caller has nothing. The endpoint still answers 200 so the recap-group editor keeps
    /// working; this flag is how the client tells "nobody to offer" from "the lookup failed".
    /// </summary>
    public bool Degraded { get; set; }

    public List<EntitlementPerson> People { get; set; } = [];
    public List<EntitlementTradeUnit> TradeUnits { get; set; } = [];
    public List<EntitlementTradeUnitGroup> Groups { get; set; } = [];
}

public class EntitlementPerson
{
    public string UserId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public List<string> TradeUnitCodes { get; set; } = [];
}

public class EntitlementTradeUnit
{
    public string Code { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class EntitlementTradeUnitGroup
{
    public int GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<string> TradeUnitCodes { get; set; } = [];
}
