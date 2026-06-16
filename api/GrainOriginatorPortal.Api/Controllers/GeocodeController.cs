// Project namespaces
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class GeocodeController : ControllerBase
{
    private readonly IGeocodeService _service;

    public GeocodeController(IGeocodeService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Geocodes a single address via Nominatim. Rate-limited to 1 req/sec.</summary>
    [HttpPost("single")]
    [ProducesResponseType(typeof(GeocodeResult), StatusCodes.Status200OK)]
    public async Task<ActionResult<GeocodeResult>> SingleGeocode([FromBody] GeocodeRequest request, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GeocodeSingleAsync(request, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Batch geocodes up to 50 addresses via Nominatim. Rate-limited to 1 req/sec per address.</summary>
    [HttpPost("batch")]
    [ProducesResponseType(typeof(List<GeocodeResult>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<GeocodeResult>>> BatchGeocode([FromBody] List<GeocodeRequest> requests, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GeocodeBatchAsync(requests, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Free-text geocode search via Nominatim (proxied server-side). Rate-limited to 1 req/sec.</summary>
    [HttpGet("search")]
    [ProducesResponseType(typeof(List<GeocodeSearchResult>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<GeocodeSearchResult>>> Search([FromQuery] string q, [FromQuery] int limit = 1, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.SearchAsync(q, limit, cancellationToken));
    }
}
