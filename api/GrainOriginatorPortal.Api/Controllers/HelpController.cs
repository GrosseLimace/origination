using System.Reflection;
using System.Text.Json;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Serves the curated self-help content behind the Help panel and the Help page.
/// <para>
/// Same delivery as What's New: the content is compiled into the assembly as an embedded resource
/// (see the .csproj) rather than served from wwwroot, because static files are served before
/// authentication and would otherwise be publicly reachable. Editing the help means editing
/// Content/help-faq.json; it ships with the next deploy.
/// </para>
/// </summary>
[ApiController]
[Route("api/help")]
[Authorize]
[Produces("application/json")]
public class HelpController : ControllerBase
{
    private const string ContentResource = "GrainOriginatorPortal.Api.Content.help-faq.json";

    // The embedded content is immutable for the lifetime of the process, so read and deserialize it
    // from the manifest once and reuse it.
    internal static readonly Lazy<HelpContentResponse> HelpContent =
        new(() => LoadContent(ContentResource));

    // -------------------------------------------------------------------------
    /// <summary>
    /// Gets every help question, the Help page categories, and the per-screen suggestions. Available
    /// to any authenticated user — help is not role-gated.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(HelpContentResponse), StatusCodes.Status200OK)]
    public ActionResult<HelpContentResponse> Get()
    {
        return Ok(HelpContent.Value);
    }

    /// <summary>
    /// Reads and deserializes the embedded help content. Internal so tests can lint the real file and
    /// point at other resource names.
    /// </summary>
    internal static HelpContentResponse LoadContent(string resourceName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"Embedded help content '{resourceName}' was not found. " +
                "Confirm the file is included as an <EmbeddedResource> in the .csproj.");

        return JsonSerializer.Deserialize<HelpContentResponse>(
            stream,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException(
                $"Embedded help content '{resourceName}' deserialized to null.");
    }
}
