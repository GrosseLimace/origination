using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Read side of the BarChart bid feed — what the "Add from BarChart" picker calls.
///
/// This is a different audience from <see cref="BarchartIngestController"/>: these endpoints serve
/// signed-in originators, so they use the standard user <c>[Authorize]</c> policy, while ingestion is
/// machine-to-machine under the <c>BarchartIngest</c> policy. Catalog reads are not trade-unit scoped:
/// the catalog is global vendor data with no Scoular customer information in it (AR-05).
/// </summary>
[ApiController]
[Route("api/barchart")]
[Authorize]
[Produces("application/json")]
public class BarchartController : ControllerBase
{
    private readonly IBarchartCatalogService _service;

    public BarchartController(IBarchartCatalogService service)
    {
        _service = service;
    }

    /// <summary>
    /// Searches the BarChart catalog. Supply <c>latitude</c>/<c>longitude</c> (and optionally
    /// <c>radiusMiles</c>) for the map-driven path; results then come back nearest-first with a distance.
    /// </summary>
    [HttpGet("locations")]
    [ProducesResponseType(typeof(List<BarchartCatalogLocationResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<BarchartCatalogLocationResponse>>> GetLocations(
        [FromQuery] BarchartLocationSearchRequest request, CancellationToken cancellationToken = default)
    {
        // Latitude and longitude only mean something together; a lone coordinate is a client bug, and
        // silently ignoring it would return a nationwide list where the user expected a local one.
        if (request.Latitude.HasValue != request.Longitude.HasValue)
            return BadRequest(new { message = "latitude and longitude must be supplied together." });

        return Ok(await _service.SearchLocationsAsync(request, cancellationToken));
    }

    /// <summary>One catalog listing plus the bids it publishes — the picker's preview before adding.</summary>
    [HttpGet("locations/{locationKey}")]
    [ProducesResponseType(typeof(BarchartCatalogLocationDetailResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BarchartCatalogLocationDetailResponse>> GetLocation(
        string locationKey, [FromQuery] string? instrumentType = null, CancellationToken cancellationToken = default)
    {
        var detail = await _service.GetLocationAsync(locationKey, instrumentType, cancellationToken);
        return detail is null ? NotFound() : Ok(detail);
    }

    /// <summary>
    /// What the catalog holds, by state. The picker shows this so an empty search reads as a coverage
    /// gap rather than a broken feed.
    /// </summary>
    [HttpGet("coverage")]
    [ProducesResponseType(typeof(BarchartCoverageResponse), StatusCodes.Status200OK)]
    public async Task<ActionResult<BarchartCoverageResponse>> GetCoverage(CancellationToken cancellationToken = default)
        => Ok(await _service.GetCoverageAsync(cancellationToken));

    /// <summary>
    /// Re-publishes current feed prices onto one linked Bid Sheet location. Normally unnecessary — the
    /// pipeline refreshes every linked location on its own schedule — but it makes a newly added
    /// location fill in immediately instead of waiting for the next run.
    /// </summary>
    [HttpPost("locations/{locationId:int}/refresh-bids")]
    [ProducesResponseType(typeof(BarchartRefreshBidsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<BarchartRefreshBidsResponse>> RefreshBids(
        int locationId, CancellationToken cancellationToken = default)
    {
        // Entitlement is checked in the service against the location's stored trade unit, not a value
        // from the caller (AR-05 fix).
        var result = await _service.RefreshBidsAsync(locationId, cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }
}
