using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class StoredGrainController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ApplicationDbContext _appContext;

    public StoredGrainController(IDataService dataService, IUserEntitlementService entitlementService, ApplicationDbContext appContext)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
        _appContext = appContext;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all stored grain records, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<StoredGrain>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrain>>> GetAll([FromQuery] string? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        var tuList = tradeUnits?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var grain = await _dataService.GetStoredGrainAsync(tuList, cancellationToken);
        if (_entitlementService.EntitlementsAvailable)
        {
            var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
            var allowedCustomerIds = await _appContext.CustomerSnapshots
                .Where(cs => cs.TradeUnit != null && allowed.Contains(cs.TradeUnit))
                .Select(cs => cs.CustomerId)
                .ToHashSetAsync(cancellationToken);
            grain = grain.Where(g => allowedCustomerIds.Contains(g.CustomerId)).ToList();
        }
        return Ok(grain);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets stored grain records for a specific customer. Open to any authenticated
    /// originator — trade-unit entitlements are a UX default, not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(List<StoredGrain>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StoredGrain>>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        return Ok(await _dataService.GetStoredGrainByCustomerAsync(customerId, cancellationToken));
    }
}
