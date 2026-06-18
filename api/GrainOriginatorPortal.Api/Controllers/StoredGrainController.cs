using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class StoredGrainController : ControllerBase
{
    private readonly IStoredGrainService _service;

    public StoredGrainController(IStoredGrainService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all stored grain records, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<StoredGrainResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrainResponse>>> GetAll([FromQuery] string? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return Ok(await _service.GetAllAsync(tuList, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets stored grain records for a specific customer. Open to any authenticated
    /// originator — trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<StoredGrainResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrainResponse>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }
}
