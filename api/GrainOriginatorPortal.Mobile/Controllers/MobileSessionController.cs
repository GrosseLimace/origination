using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>GET /me — the caller's display name, entitled trade units and their groups (operation <c>getSession</c>).</summary>
[Route(RoutePrefix + "/me")]
public sealed class MobileSessionController : MobileControllerBase
{
    private readonly IUserEntitlementService _entitlements;
    private readonly IUserTradeUnitService _userTradeUnits;
    private readonly IRequestContextService _requestContext;

    public MobileSessionController(
        IUserEntitlementService entitlements,
        IUserTradeUnitService userTradeUnits,
        IRequestContextService requestContext)
    {
        _entitlements = entitlements;
        _userTradeUnits = userTradeUnits;
        _requestContext = requestContext;
    }

    [HttpGet]
    [ProducesResponseType(typeof(SessionDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<SessionDto>> Get(CancellationToken cancellationToken)
    {
        var allowed = await _entitlements.GetAllowedTradeUnitCodesAsync(cancellationToken);
        var groups = await _userTradeUnits.GetForCurrentUserAsync(cancellationToken);

        var names = groups
            .SelectMany(g => g.TradeUnits)
            .GroupBy(t => t.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Description, StringComparer.OrdinalIgnoreCase);


        var tradeUnits = allowed
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .Select(code => new TradeUnitDto
            {
                Code = code,
                Name = names.TryGetValue(code, out var name) && !string.IsNullOrWhiteSpace(name) ? name : code,
            })
            .ToList();

        // Groups only ever list codes the caller is entitled to; a group with none left is dropped.
        var groupDtos = groups
            .Select(g => new TradeUnitGroupDto
            {
                Name = g.GroupName,
                TradeUnitCodes = g.TradeUnitCodes
                    .Concat(g.TradeUnits.Select(t => t.Code))
                    .Where(allowed.Contains)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                    .ToList(),
            })
            .Where(g => g.TradeUnitCodes.Count > 0)
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Ok(new SessionDto
        {
            DisplayName = _requestContext.GetCurrentUserShortName(),
            TradeUnits = tradeUnits,
            Groups = groupDtos,
        });
    }
}
