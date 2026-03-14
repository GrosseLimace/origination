using GrainOriginatorPortal.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class UserTradeUnitsController : ControllerBase
{
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly ApplicationDbContext _appDb;
    private readonly ILogger<UserTradeUnitsController> _logger;

    public UserTradeUnitsController(EntitlementsDbContext entitlementsDb, ApplicationDbContext appDb, ILogger<UserTradeUnitsController> logger)
    {
        _entitlementsDb = entitlementsDb;
        _appDb = appDb;
        _logger = logger;
    }

    /// <summary>
    /// Returns the trade unit codes assigned to the currently authenticated user,
    /// grouped by Azure AD group name. UserId is derived from the UPN claim
    /// (e.g. CEgr@scoular.com → CEgr).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var upn = User.FindFirst("preferred_username")?.Value
            ?? User.FindFirst("upn")?.Value
            ?? User.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")?.Value
            ?? User.Identity?.Name
            ?? string.Empty;

        var userId = upn.Contains('@') ? upn.Split('@')[0] : upn;

        if (string.IsNullOrWhiteSpace(userId))
            return Unauthorized("Unable to determine user identity from token.");

        try
        {
            var rows = await _entitlementsDb.UserTradeUnitAccess
                .Where(u => u.UserId == userId)
                .Select(u => new UserTradeUnitRow { GroupName = u.GroupName, TradeUnitCode = u.TradeUnitCode })
                .Distinct()
                .ToListAsync();

            var result = rows
                .GroupBy(u => u.GroupName ?? "Default")
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    groupName = g.Key,
                    tradeUnitCodes = g.Select(u => u.TradeUnitCode).Distinct().OrderBy(c => c).ToList()
                });

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements DB unavailable for user {UserId} — falling back to all trade units from CustomerSnapshot", userId);
            return Ok(await GetFallbackTradeUnitsAsync());
        }
    }
    private async Task<object[]> GetFallbackTradeUnitsAsync()
    {
        try
        {
            var units = await _appDb.CustomerSnapshots
                .AsNoTracking()
                .Where(s => s.IsActive && s.TradeUnit != null)
                .Select(s => s.TradeUnit!)
                .Distinct()
                .OrderBy(u => u)
                .ToListAsync();

            if (units.Count == 0) return [];

            return [new { groupName = "All Trade Units", tradeUnitCodes = units }];
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CustomerSnapshot fallback also failed — returning empty trade unit list");
            return [];
        }
    }
}

file class UserTradeUnitRow
{
    public string? GroupName { get; set; }
    public string TradeUnitCode { get; set; } = string.Empty;
}
