using System.ComponentModel.DataAnnotations;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Storage;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Per-trade-unit facts the phone needs after the trade units are picked (operation <c>getTradeUnitStorage</c>).</summary>
[Route(RoutePrefix + "/trade-units")]
[RequireTradeUnitEntitlement]
public sealed class MobileTradeUnitsController : MobileControllerBase
{
    private readonly ITradeUnitStorageLookup _storage;

    public MobileTradeUnitsController(ITradeUnitStorageLookup storage) => _storage = storage;

    /// <summary>
    /// Card #648: whether each selected trade unit offers storage, which decides whether the Storage &amp; DP
    /// tab exists for its producers. Asked separately from the producer read because the answer can take a
    /// few seconds the first time (it is then cached), and opening a producer must not wait on it.
    /// </summary>
    [HttpGet("storage")]
    [ProducesResponseType(typeof(IReadOnlyList<TradeUnitStorageDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<TradeUnitStorageDto>>> GetStorage(
        [FromQuery, Required, MinLength(1), MaxLength(20)] List<string> tradeUnits,
        CancellationToken cancellationToken)
    {
        // The entitlement filter has already rejected any code outside the caller's trade units (403).
        var result = new List<TradeUnitStorageDto>();
        foreach (var code in tradeUnits.Where(c => !string.IsNullOrWhiteSpace(c)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            // Sequential on purpose: the services share one scoped DbContext.
            result.Add(new TradeUnitStorageDto { Code = code, OffersStorage = await _storage.OffersStorageAsync(code, cancellationToken) });
        }
        return Ok(result);
    }
}
