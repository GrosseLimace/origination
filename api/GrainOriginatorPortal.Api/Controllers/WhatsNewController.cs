using System.Reflection;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Serves the curated "What's New" release notes shown in the app after a deploy.
/// <para>
/// The notes are compiled into the assembly as an embedded resource (see the .csproj) rather
/// than served from wwwroot, because static files are served before authentication and would
/// otherwise be publicly reachable.
/// </para>
/// <para>
/// The file ships with the deploy, so nothing needs to stamp a release version at build time:
/// the first entry in the file <em>is</em> the current release, and the client shows its notice
/// when that version differs from the one it last recorded. A deploy that changes nothing a user
/// would notice simply does not touch the file, and no notice fires.
/// </para>
/// </summary>
[ApiController]
[Route("api/whats-new")]
[Authorize]
[Produces("application/json")]
public class WhatsNewController : ControllerBase
{
    private const string ReleasesResource = "GrainOriginatorPortal.Api.Content.whats-new.json";

    // The embedded notes are immutable for the lifetime of the process, so read and deserialize
    // them from the manifest once and reuse the list.
    internal static readonly Lazy<IReadOnlyList<WhatsNewReleaseResponse>> Releases =
        new(() => LoadReleases(ReleasesResource));

    // -------------------------------------------------------------------------
    /// <summary>
    /// Gets every published release, newest first. Available to any authenticated user —
    /// release notes are not role-gated.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<WhatsNewReleaseResponse>), StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<WhatsNewReleaseResponse>> Get()
    {
        return Ok(Releases.Value);
    }

    /// <summary>
    /// Reads and deserializes the embedded release notes. Internal so tests can lint the real
    /// file and point at other resource names.
    /// </summary>
    internal static IReadOnlyList<WhatsNewReleaseResponse> LoadReleases(string resourceName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"Embedded release notes '{resourceName}' were not found. " +
                "Confirm the file is included as an <EmbeddedResource> in the .csproj.");

        var releases = JsonSerializer.Deserialize<List<WhatsNewReleaseResponse>>(
            stream,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException(
                $"Embedded release notes '{resourceName}' deserialized to null.");

        return releases;
    }
}
