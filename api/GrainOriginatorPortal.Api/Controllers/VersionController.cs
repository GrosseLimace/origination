using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Reports which build is running, so a bug report can be tied to a specific deploy.
/// <para>
/// Combines the human release number authored in the release notes with the commit and workflow
/// run CI stamped into the assembly. The SPA shows the result in the profile menu.
/// </para>
/// </summary>
[ApiController]
[Route("api/version")]
[Authorize]
[Produces("application/json")]
public class VersionController : ControllerBase
{
    private readonly IHostEnvironment _environment;

    public VersionController(IHostEnvironment environment)
    {
        _environment = environment;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets the running release version, build stamp, and environment name.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(VersionResponse), StatusCodes.Status200OK)]
    public ActionResult<VersionResponse> Get()
    {
        // Null when no releases have been published yet — the build stamp is still useful, so
        // report it rather than failing.
        var current = WhatsNewController.Releases.Value.FirstOrDefault();

        return Ok(new VersionResponse
        {
            ReleaseVersion = current?.Version,
            ReleasedOn = current?.ReleasedOn,
            CommitSha = BuildInfo.CommitSha,
            ShortSha = BuildInfo.ShortSha,
            BuildNumber = BuildInfo.BuildNumber,
            Environment = _environment.EnvironmentName
        });
    }
}
