using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Tells the browser app where to send its error telemetry. Served at runtime rather than baked into
/// the build's environment files, so every environment uses the App Insights resource its App
/// Service is already configured with.
/// <para>
/// Signed-in users only. The consequence is that a failure before the first sign-in completes is
/// not reported; anything after it, including token-refresh failures, is.
/// </para>
/// </summary>
[ApiController]
[Route("api/clienttelemetry")]
[Authorize]
[Produces("application/json")]
public class ClientTelemetryController : ControllerBase
{
    private readonly ClientTelemetrySettings _settings;

    public ClientTelemetryController(ClientTelemetrySettings settings)
    {
        _settings = settings;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the App Insights connection string for the browser, or null when browser
    /// telemetry is off in this environment.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ClientTelemetryResponse), StatusCodes.Status200OK)]
    public ActionResult<ClientTelemetryResponse> Get() =>
        Ok(new ClientTelemetryResponse { ConnectionString = _settings.ConnectionString });
}

public class ClientTelemetryResponse
{
    public string? ConnectionString { get; set; }
}
