using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[Produces("application/json")]
public class ProducerDetailsController : ControllerBase
{
    private readonly IDataService _dataService;
    private readonly IUserEntitlementService _entitlementService;
    private readonly ApplicationDbContext _appContext;

    public ProducerDetailsController(IDataService dataService, IUserEntitlementService entitlementService, ApplicationDbContext appContext)
    {
        _dataService = dataService;
        _entitlementService = entitlementService;
        _appContext = appContext;
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets all producer details records, filtered to the caller's entitled trade units.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProducerDetails>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ProducerDetails>>> GetAll(CancellationToken cancellationToken = default)
    {
        var details = await _dataService.GetAllProducerDetailsAsync(cancellationToken);
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        var allowedCustomerIds = await _appContext.CustomerTradeUnits
            .Where(ctu => allowed.Contains(ctu.TradeUnit) && ctu.IsActive)
            .Select(ctu => ctu.CustomerId)
            .ToHashSetAsync(cancellationToken);
        details = details.Where(d => allowedCustomerIds.Contains(d.CustomerId)).ToList();
        return Ok(details);
    }

    // -------------------------------------------------------------------------
    /// <summary>Gets producer details for a specific customer. Returns an empty record if not yet saved.
    /// Open to any authenticated originator — trade-unit entitlements are a UX default,
    /// not an access-control boundary.</summary>
    [HttpGet("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    public async Task<ActionResult<ProducerDetails>> GetByCustomer(long customerId, CancellationToken cancellationToken = default)
    {
        var details = await _dataService.GetProducerDetailsAsync(customerId, cancellationToken);
        return Ok(details ?? new ProducerDetails { CustomerId = customerId });
    }

    // -------------------------------------------------------------------------
    /// <summary>Creates or updates producer details for a customer.</summary>
    [HttpPut("customer/{customerId:long}")]
    [ProducesResponseType(typeof(ProducerDetails), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ProducerDetails>> Upsert(long customerId, [FromBody] UpsertProducerDetailsRequest request, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may save producer details for any customer.
        // No per-record ownership check is intentional; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01).
        var details = await _dataService.UpsertProducerDetailsAsync(
            customerId,
            request.ScoularId,
            request.CustomerName,
            request.TotalAcres,
            request.BinCapacity,
            request.PrimaryContact,
            request.Commodities,
            request.LinkedProducerIds,
            cancellationToken
        );
        return Ok(details);
    }

    // -------------------------------------------------------------------------
    /// <summary>Deletes producer details for a customer.</summary>
    [HttpDelete("customer/{customerId:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> Delete(long customerId, CancellationToken cancellationToken = default)
    {
        // Trade units are a UX filter, not an access boundary — any rep may delete any producer's details.
        await _dataService.DeleteProducerDetailsAsync(customerId, cancellationToken);
        return NoContent();
    }
}
