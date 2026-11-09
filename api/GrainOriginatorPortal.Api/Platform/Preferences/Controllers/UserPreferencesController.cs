using Microsoft.AspNetCore.Mvc;
using GrainOriginatorPortal.Api.Platform.Preferences;
using GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;
using GrainOriginatorPortal.Api.Platform.Access;
using GrainOriginatorPortal.Infrastructure.Platform.Access;

namespace GrainOriginatorPortal.Api.Platform.Preferences.Controllers;

[ApiController]
[Route("api/[controller]")]
[RequirePermission(AppPermissions.Platform.PreferencesReadOwn)]
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
    [RequirePermission(AppPermissions.Platform.PreferencesWriteOwn)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Upsert([FromBody] UserPreferenceDto dto, CancellationToken cancellationToken)
    {
        await _service.SetAsync(dto, cancellationToken);
        return NoContent();
    }
}
