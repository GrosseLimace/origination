using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Platform.Preferences;
using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Platform.Preferences.Controllers;

/// <summary>
/// All trade units in the system — used by the producer-onboarding UI's "assign trade
/// units" dropdown, which (by product decision) lets a user pick any TU, not just the
/// ones they're entitled to. Sourced from the TradeUnitPreferences DB's vw_UserTradeUnitPreference
/// (the authoritative TU catalog); falls back to dbo.CustomerTradeUnit if entitlements
/// is unavailable.
/// </summary>
[RequirePermission(AppPermissions.Platform.ReferenceDataRead)]
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
