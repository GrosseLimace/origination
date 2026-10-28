// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Backs the incoming-call popup. The browser's ACS Calling SDK does the actual ringing; this
/// controller only (1) mints the token that lets the SDK act as the signed-in user's own Teams
/// Phone endpoint and (2) turns a caller id into the matching producers.
/// <para>
/// Both endpoints are per-user by construction: the token is minted for the caller's own identity
/// and the match reads the same customer rows the caller can already search.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class CallingController : ControllerBase
{
    private readonly ICallingTokenService _tokens;
    private readonly ICallingMatchService _matches;

    public CallingController(ICallingTokenService tokens, ICallingMatchService matches)
    {
        _tokens = tokens;
        _matches = matches;
    }

    // -------------------------------------------------------------------------
    /// <summary>A calling token for the signed-in user's Teams identity.
    /// <para><b>204</b> means the feature is unavailable in this environment (no ACS resource
    /// configured, consent not granted, or the exchange failed). The client treats that as "off"
    /// and never loads the calling SDK, so it is a normal answer rather than an error.</para></summary>
    [HttpGet("token")]
    [ProducesResponseType(typeof(CallingTokenResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult<CallingTokenResponse>> GetToken(CancellationToken cancellationToken = default)
    {
        var token = await _tokens.GetTokenForCallerAsync(cancellationToken);
        return token is null ? NoContent() : Ok(token);
    }

    // -------------------------------------------------------------------------
    /// <summary>Producers whose phone on file matches the caller id. Always 200; an empty list is
    /// the "unknown caller" case. The number is never logged (it is a producer's phone).</summary>
    [HttpGet("match")]
    [ProducesResponseType(typeof(List<IncomingCallMatchResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<IncomingCallMatchResponse>>> Match(
        [FromQuery] string? number, CancellationToken cancellationToken = default)
    {
        return Ok(await _matches.MatchAsync(number, cancellationToken));
    }
}
