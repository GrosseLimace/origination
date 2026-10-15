using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Storage and DP contract cards (card #648): operations <c>getStorageCards</c> and <c>getDpContractCards</c>. ODS reads.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}")]
[RequireTradeUnitEntitlement]
public sealed class MobileStorageController : MobileControllerBase
{
    private readonly IStoredGrainService _storedGrain;
    private readonly IDpContractService _dpContracts;

    public MobileStorageController(IStoredGrainService storedGrain, IDpContractService dpContracts)
    {
        _storedGrain = storedGrain;
        _dpContracts = dpContracts;
    }

    /// <summary>Warehouse-receipt positions. The client hides this tab when the trade unit's <c>offersStorage</c> is false.</summary>
    [HttpGet("storage")]
    [ProducesResponseType(typeof(List<StorageCardDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StorageCardDto>>> GetStorage(long customerId, CancellationToken cancellationToken)
    {
        var positions = await _storedGrain.GetByCustomerAsync(customerId, cancellationToken);
        return Ok(positions
            .OrderByDescending(p => p.DateReceived)
            .Select(p => p.ToCard())
            .ToList());
    }

    /// <summary>
    /// Deferred-payment balances, one card per DP contract (see <see cref="DpRollup"/>: the view has a row per charge
    /// type per delivery). DP data exists only in production ODS; Dev and QA return an empty list by design.
    /// </summary>
    [HttpGet("dp-contracts")]
    [ProducesResponseType(typeof(List<DpContractCardDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<DpContractCardDto>>> GetDpContracts(long customerId, CancellationToken cancellationToken)
    {
        var rows = await _dpContracts.GetByCustomerAsync(customerId, cancellationToken);
        return Ok(DpRollup.ByContract(rows));
    }
}
