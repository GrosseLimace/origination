// Project namespaces
using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Registry of Microsoft Teams channels that can be @-mentioned in a note.
/// <para>
/// The composer looks a channel up in Microsoft Graph with the SIGNED-IN USER'S OWN token — so it
/// only ever offers channels that person belongs to — then posts it here the first time it is
/// picked. From then on the channel is mentionable by everyone, which is the point: one person's
/// pick serves the whole team, and nobody has to paste an address.
/// </para>
/// <para>
/// A registered row is only ever referenced by id. The note never stores the channel address, and
/// this controller never returns it.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class TeamsChannelsController : ControllerBase
{
    private readonly ITeamsChannelService _service;
    private readonly ILogger<TeamsChannelsController> _logger;

    public TeamsChannelsController(ITeamsChannelService service, ILogger<TeamsChannelsController> logger)
    {
        _service = service;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    /// <summary>Every registered channel. Unfiltered: a registered channel is mentionable by anyone.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<TeamsChannelDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TeamsChannelDto>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Registers a channel picked in the composer, or returns the row that already exists
    /// for it. Idempotent, so the composer can call it on every pick without checking first.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(TeamsChannelDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<TeamsChannelDto>> Register(
        [FromBody] RegisterTeamsChannelRequest request, CancellationToken cancellationToken = default)
    {
        var channel = await _service.RegisterAsync(request, cancellationToken);
        // Registration makes a channel mentionable by the whole company, so it is worth an audit
        // line even though it exposes nothing by itself.
        _logger.LogInformation(
            "Teams channel registered [{ErrorCode}] [{ErrorCategory}]: ChannelDbId={ChannelDbId}, Team={TeamName}, Channel={DisplayName}",
            "AUDIT_CREATE", "DataMutation", channel.Id, channel.TeamName, channel.DisplayName);
        return Ok(channel);
    }
}
