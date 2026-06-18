using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class UserPreferencesController : ControllerBase
{
    private readonly IUserPreferenceService _service;

    public UserPreferencesController(IUserPreferenceService service) => _service = service;

    // -------------------------------------------------------------------------
    /// <summary>Gets the current user's saved trade unit / group preferences.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(UserPreferenceDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<UserPreferenceDto>> Get(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates the current user's trade unit / group preferences.</summary>
    [HttpPut]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Upsert([FromBody] UserPreferenceDto dto, CancellationToken cancellationToken)
    {
        await _service.SetAsync(dto, cancellationToken);
        return NoContent();
    }
}
