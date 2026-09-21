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
        // Open to any rep — no per-producer object-level authz by design; see
        // SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-02). Mirrors the citation on the sibling
        // DpContractsController route. This route was missing from AR-02's own table until
        // 2026-09-21 — exactly the undocumented-deliberate-decision pattern that entry warns about.
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }
}
