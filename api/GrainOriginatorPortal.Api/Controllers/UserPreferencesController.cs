using System.Text.Json;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class UserPreferencesController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public UserPreferencesController(ApplicationDbContext db) => _db = db;

    private string CurrentUserId
    {
        get
        {
            var upn = User.FindFirst("preferred_username")?.Value
                   ?? User.FindFirst("upn")?.Value
                   ?? User.Identity?.Name
                   ?? string.Empty;
            return upn.Contains('@') ? upn.Split('@')[0] : upn;
        }
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the current user's saved trade unit / group preferences.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(UserPreferenceDto), StatusCodes.Status200OK)]
    public async Task<ActionResult<UserPreferenceDto>> Get(CancellationToken cancellationToken)
    {
        var pref = await _db.UserPreferences.FirstOrDefaultAsync(p => p.UserId == CurrentUserId, cancellationToken);
        if (pref == null) return Ok(new UserPreferenceDto());
        return Ok(new UserPreferenceDto
        {
            SelectedGroupNames = JsonSerializer.Deserialize<string[]>(pref.SelectedGroupNames) ?? [],
            SelectedTradeUnits = JsonSerializer.Deserialize<string[]>(pref.SelectedTradeUnits) ?? []
        });
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates the current user's trade unit / group preferences.</summary>
    [HttpPut]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Upsert([FromBody] UserPreferenceDto dto, CancellationToken cancellationToken)
    {
        var pref = await _db.UserPreferences.FirstOrDefaultAsync(p => p.UserId == CurrentUserId, cancellationToken);
        if (pref == null)
        {
            pref = new UserPreference { UserId = CurrentUserId };
            _db.UserPreferences.Add(pref);
        }
        pref.SelectedGroupNames = JsonSerializer.Serialize(dto.SelectedGroupNames ?? []);
        pref.SelectedTradeUnits = JsonSerializer.Serialize(dto.SelectedTradeUnits ?? []);
        pref.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }
}
