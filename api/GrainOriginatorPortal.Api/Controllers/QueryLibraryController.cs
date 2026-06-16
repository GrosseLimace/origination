using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/query-library")]
[Authorize]
[Produces("application/json")]
public class QueryLibraryController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly ILogger<QueryLibraryController> _logger;

    public QueryLibraryController(IDataService dataService, ILogger<QueryLibraryController> logger)
    {
        _dataService = dataService;
        _logger = logger;
    }

    /// <summary>Gets all active query library items, sorted by category then sort order.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<QueryLibraryItem>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<QueryLibraryItem>>> GetAll(CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetQueryLibraryAsync(cancellationToken));
    }

    /// <summary>Logs a user's query library search for gap analysis (unmatched searches help identify missing queries).</summary>
    [HttpPost("search-log")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> LogSearch([FromBody] LogQuerySearchRequest request, CancellationToken cancellationToken = default)
    {
        await _dataService.LogQuerySearchAsync(request.SearchText, request.MatchedQueryId, cancellationToken);
        return NoContent();
    }
}
