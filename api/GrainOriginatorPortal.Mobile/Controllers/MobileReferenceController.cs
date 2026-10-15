using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Reference data: operation <c>getPlantingCommodities</c> (card #647).</summary>
[Route(RoutePrefix + "/reference")]
public sealed class MobileReferenceController : MobileControllerBase
{
    private readonly ICommodityService _commodities;

    public MobileReferenceController(ICommodityService commodities)
    {
        _commodities = commodities;
    }

    /// <summary>Crops selectable when adding a planting intention. Trade-unit and trade-group scoping is applied by the service.</summary>
    [HttpGet("commodities")]
    [ProducesResponseType(typeof(List<CommodityDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CommodityDto>>> GetPlantingCommodities(CancellationToken cancellationToken)
    {
        var commodities = await _commodities.GetPlantingAsync(cancellationToken);
        return Ok(commodities
            .Where(c => c.IsActive)
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Select(c => c.ToDto())
            .ToList());
    }
}
