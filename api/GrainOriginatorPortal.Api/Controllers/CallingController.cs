// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Backs the incoming-call popup. The browser's ACS Calling SDK does the actual ringing; this
/// controller only (1) exchanges the browser's Entra token for the ACS calling token that lets the
/// SDK act as the signed-in user's own Teams Phone endpoint and (2) turns a caller id into the
/// matching producers.
/// <para>
/// Both endpoints are per-user by construction: the exchange is bound to the caller's own object id
/// (from their validated API token) and the match reads the same customer rows the caller can
/// already search. Same <c>[Authorize]</c> gate as every other controller: a valid Workbench API token.
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
    private readonly IRequestContextService _requestContext;

    public CallingController(
        ICallingTokenService tokens,
        ICallingMatchService matches,
        IRequestContextService requestContext)
    {
        _tokens = tokens;
        _matches = matches;
        _requestContext = requestContext;
    }

    // -------------------------------------------------------------------------
    /// <summary>Exchanges the browser's Entra token for the ACS scopes into a calling token for the
    /// signed-in user's Teams identity.
    /// <para><b>204</b> means calling is not configured in this environment. The client treats that
    /// as "off" and never loads the calling SDK, so it is a normal answer rather than an error.
    /// <b>400</b>: no token in the body. <b>502</b>: ACS refused or could not be reached.</para></summary>
    [HttpPost("token")]
    [ProducesResponseType(typeof(CallingTokenResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiErrorResponse), StatusCodes.Status502BadGateway)]
    public async Task<ActionResult<CallingTokenResponse>> ExchangeToken(
        [FromBody] ExchangeCallingTokenRequest request, CancellationToken cancellationToken = default)
    {
        var result = await _tokens.ExchangeAsync(request.TeamsUserAadToken, cancellationToken);
        return result.Outcome switch
        {
            CallingTokenOutcome.Issued => Ok(result.Token),
            CallingTokenOutcome.Unavailable => NoContent(),
            CallingTokenOutcome.InvalidRequest => BadRequest(Error("VALIDATION_ERROR",
                "The request must carry the Entra token acquired for the Azure Communication Services scopes.")),
            _ => StatusCode(StatusCodes.Status502BadGateway, Error("CALLING_TOKEN_EXCHANGE_FAILED",
                "Azure Communication Services did not issue a calling token. Try again shortly.")),
        };
    }

    // -------------------------------------------------------------------------
    /// <summary>Producers whose phone on file matches the caller id. Always 200; an empty list is
    /// the "unknown caller" case. The number is never logged (it is a producer's phone).
    /// <para>POST with the number in the body, not GET with a query string: App Service
    /// auto-instrumentation records the full request URL in Application Insights (<c>requests.url</c>),
    /// so a query string would put every caller's number there (Infrastructure, 2026-10-29). Bodies are
    /// not recorded.</para></summary>
    [HttpPost("match")]
    [ProducesResponseType(typeof(List<IncomingCallMatchResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<IncomingCallMatchResponse>>> Match(
        [FromBody] MatchIncomingCallRequest request, CancellationToken cancellationToken = default)
    {
        return Ok(await _matches.MatchAsync(request?.Number, cancellationToken));
    }

    private ApiErrorResponse Error(string code, string message) => new()
    {
        Error = new ApiErrorBody
        {
            Code = code,
            Message = message,
            TraceId = _requestContext.GetTraceId(),
            Timestamp = DateTime.UtcNow.ToString("O"),
            Instance = HttpContext?.Request.Path.Value,
        },
    };
}
