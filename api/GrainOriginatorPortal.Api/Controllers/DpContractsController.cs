using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class DpContractsController : ControllerBase
{
    private readonly IDpContractService _service;

    public DpContractsController(IDpContractService service)
    {
        _service = service;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all DP contract positions, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<DpContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<DpContractResponse>>> GetAll([FromQuery] string? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return Ok(await _service.GetAllAsync(tuList, cancellationToken));
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets DP contract positions for a specific customer. Open to any authenticated
    /// originator — trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<DpContractResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<DpContractResponse>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _service.GetByCustomerAsync(customerId, cancellationToken));
    }
}
