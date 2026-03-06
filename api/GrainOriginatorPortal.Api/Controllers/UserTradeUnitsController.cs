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

    public UserTradeUnitsController(EntitlementsDbContext entitlementsDb)
    {
        _entitlementsDb = entitlementsDb;
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

        var rows = await _entitlementsDb.UserTradeUnitAccess
            .Where(u => u.UserId == userId)
            .Select(u => new { u.GroupName, u.TradeUnitCode })
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
}
