using GrainOriginatorPortal.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// All trade units in the system — used by the producer-onboarding UI's "assign trade
/// units" dropdown, which (by product decision) lets a user pick any TU, not just the
/// ones they're entitled to. Sourced from the Entitlements DB's vw_UserTradeUnitAccess
/// (the authoritative TU catalog); falls back to dbo.CustomerTradeUnit if entitlements
/// is unavailable.
/// </summary>
[Authorize]
[ApiController]
[Route("api/trade-units")]
public class TradeUnitsController : ControllerBase
{
    private readonly EntitlementsDbContext _entitlementsDb;
    private readonly ApplicationDbContext _appDb;
    private readonly ILogger<TradeUnitsController> _logger;

    public TradeUnitsController(EntitlementsDbContext entitlementsDb, ApplicationDbContext appDb, ILogger<TradeUnitsController> logger)
    {
        _entitlementsDb = entitlementsDb;
        _appDb = appDb;
        _logger = logger;
    }

    /// <summary>Returns every distinct trade unit (code + description), ordered by code.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<TradeUnitOption>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TradeUnitOption>>> GetAll(CancellationToken cancellationToken = default)
    {
        try
        {
            var rows = await _entitlementsDb.UserTradeUnitAccess
                .AsNoTracking()
                .Where(u => u.TradeUnitCode != null && u.TradeUnitCode != "")
                .Select(u => new { u.TradeUnitCode, u.Description })
                .ToListAsync(cancellationToken);

            var options = rows
                .GroupBy(r => r.TradeUnitCode, StringComparer.OrdinalIgnoreCase)
                .Select(g => new TradeUnitOption
                {
                    Code = g.Key,
                    Description = g.Select(x => x.Description).FirstOrDefault(d => !string.IsNullOrWhiteSpace(d)),
                })
                .OrderBy(o => o.Code, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Ok(options);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Entitlements TU catalog unavailable — falling back to dbo.CustomerTradeUnit");
            try
            {
                var codes = await _appDb.CustomerTradeUnits
                    .AsNoTracking()
                    .Where(t => t.IsActive)
                    .Select(t => t.TradeUnit)
                    .Distinct()
                    .OrderBy(t => t)
                    .ToListAsync(cancellationToken);
                return Ok(codes.Select(c => new TradeUnitOption { Code = c }).ToList());
            }
            catch (Exception inner)
            {
                _logger.LogWarning(inner, "CustomerTradeUnit fallback also failed — returning empty TU list");
                return Ok(new List<TradeUnitOption>());
            }
        }
    }
}

public class TradeUnitOption
{
    public string Code { get; set; } = string.Empty;
    public string? Description { get; set; }
}
