using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// All trade units in the system — used by the producer-onboarding UI's "assign trade
/// units" dropdown, which (by product decision) lets a user pick any TU, not just the
/// ones they're entitled to. Sourced from the Entitlements DB's vw_UserTradeUnitPreference
/// (the authoritative TU catalog); falls back to dbo.CustomerTradeUnit if entitlements
/// is unavailable.
/// </summary>
[Authorize]
[ApiController]
[Route("api/trade-units")]
[Produces("application/json")]
public class TradeUnitsController : ControllerBase
{
    private readonly ITradeUnitService _service;

    public TradeUnitsController(ITradeUnitService service)
    {
        _service = service;
    }

    /// <summary>Returns every distinct trade unit (code + description), ordered by code.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<TradeUnitOptionResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TradeUnitOptionResponse>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }
}
