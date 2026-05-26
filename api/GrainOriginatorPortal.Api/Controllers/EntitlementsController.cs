using GrainOriginatorPortal.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Read-only catalog of the entitlements directory — used by the Daily Digest
/// "Recap Group" picker to surface people, trade units, and trade-unit groups
/// the merchandiser can include as recipients. Backed by <c>vw_UserTradeUnitAccess</c>
/// in the Entitlements database (a flattened user × trade-unit × group join).
///
/// All three lists are returned in one response so the picker dialog can fetch
/// once when it opens.
/// </summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
public class EntitlementsController : ControllerBase
{
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly ILogger<EntitlementsController> _logger;

    public EntitlementsController(EntitlementsDbContext entitlementsDb, ILogger<EntitlementsController> logger)
    {
        _entitlementsDb = entitlementsDb;
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
        var upn = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("upn")?.Value
            ?? User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? User.Identity?.Name
            ?? string.Empty;

        // UserTradeUnitAccess.UserId is the UPN prefix (e.g. "CEgr"), not the full UPN.
        var userId = upn.Contains('@') ? upn.Split('@')[0] : upn;
        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized("Unable to determine user identity from token.");

        try
        {
            // Single read of the view, then everything else is in-memory set math —
            // small data shape (one row per user × TU × group) makes this fast.
            var rows = await _entitlementsDb.UserTradeUnitAccess
                .AsNoTracking()
                .ToListAsync(ct);

            // Caller's own TUs — drives the People filter (must share a TU with caller).
            var callerTuCodes = rows
                .Where(r => string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase))
                .Select(r => r.TradeUnitCode)
                .Where(c => !string.IsNullOrWhiteSpace(c))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (callerTuCodes.Count == 0)
            {
                // User has no entitlements at all — return empty rather than surfacing
                // the org-wide directory.
                return Ok(new EntitlementsCatalogResponse());
            }

            // People who share ≥1 TU with the caller. Caller is excluded — they
            // shouldn't add themselves as a recipient.
            var people = rows
                .Where(r => callerTuCodes.Contains(r.TradeUnitCode))
                .Where(r => !string.IsNullOrWhiteSpace(r.UserId))
                .Where(r => !string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase))
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
            var tradeUnits = rows
                .Where(r => callerTuCodes.Contains(r.TradeUnitCode))
                .GroupBy(r => r.TradeUnitCode, StringComparer.OrdinalIgnoreCase)
                .Select(g => new EntitlementTradeUnit
                {
                    Code = g.Key,
                    Description = g.First().Description,
                })
                .OrderBy(t => t.Code, StringComparer.OrdinalIgnoreCase)
                .ToList();

            // Groups the caller is a member of. Each group lists its TUs so the
            // Logic App can expand it the same way the entitlements layer does.
            var callerGroupIds = rows
                .Where(r => string.Equals(r.UserId, userId, StringComparison.OrdinalIgnoreCase))
                .Where(r => r.GroupId.HasValue)
                .Select(r => r.GroupId!.Value)
                .ToHashSet();

            var groups = rows
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
            return Ok(new EntitlementsCatalogResponse());
        }
    }
}

public class EntitlementsCatalogResponse
{
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
