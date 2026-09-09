using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class UserTradeUnitsController : ControllerBase
{
    private readonly IUserTradeUnitService _service;

    public UserTradeUnitsController(IUserTradeUnitService service)
    {
        _service = service;
    }

    /// <summary>
    /// Returns the trade unit codes assigned to the currently authenticated user,
    /// grouped by Azure AD group name. UserId is derived from the UPN claim
    /// (e.g. CEgr@scoular.com → CEgr). An empty 200 means the user has no assignments;
    /// a TradeUnitPreferences DB outage is a 503 so the client can tell the two apart.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<UserTradeUnitGroupResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<List<UserTradeUnitGroupResponse>>> Get(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetForCurrentUserAsync(cancellationToken));
    }
}
