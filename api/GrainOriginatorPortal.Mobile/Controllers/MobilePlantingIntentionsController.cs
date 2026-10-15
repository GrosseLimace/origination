using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Idempotency;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Planting intentions (card #647): operations <c>getPlantingIntentions</c>, <c>createPlantingIntention</c>, <c>updatePlantingIntention</c>.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}/planting-intentions")]
[RequireTradeUnitEntitlement]
public sealed class MobilePlantingIntentionsController : MobileControllerBase
{
    private readonly IPlantingIntentionService _plantings;
    private readonly ICustomerService _customers;
    private readonly ICommodityService _commodities;
    private readonly IUserEntitlementService _entitlements;
    private readonly IIdempotencyStore _idempotency;
    private readonly IAuditScope _audit;

    public MobilePlantingIntentionsController(
        IPlantingIntentionService plantings,
        ICustomerService customers,
        ICommodityService commodities,
        IUserEntitlementService entitlements,
        IIdempotencyStore idempotency,
        IAuditScope audit)
    {
        _plantings = plantings;
        _customers = customers;
        _commodities = commodities;
        _entitlements = entitlements;
        _idempotency = idempotency;
        _audit = audit;
    }

    [HttpGet]
    [ProducesResponseType(typeof(List<PlantingIntentionDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PlantingIntentionDto>>> Get(long customerId, CancellationToken cancellationToken)
    {
        var intentions = await _plantings.GetByCustomerAsync(customerId, cancellationToken);
        return Ok(intentions
            .OrderByDescending(p => p.PlantingYear)
            .ThenBy(p => p.Crop)
            .Select(p => p.ToDto())
            .ToList());
    }

    [HttpPost]
    [ProducesResponseType(typeof(PlantingIntentionDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(PlantingIntentionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlantingIntentionDto>> Create(long customerId, [FromBody] PlantingIntentionCreateRequest request, CancellationToken cancellationToken)
    {
        _audit.Entity("PlantingIntention", null);

        if (_idempotency.TryGet<PlantingIntentionDto>(UserKey, request.ClientRequestId, out var replay) && replay is not null)
        {
            return Ok(replay);
        }

        var customer = await _customers.GetByIdAsync(customerId, cancellationToken)
                       ?? throw new NotFoundException("Customer", customerId);

        var commodity = await ResolveCommodityAsync(request.Crop, cancellationToken);
        var type = NormaliseType(request.Type);
        var tradeUnit = string.IsNullOrWhiteSpace(request.TradeUnit)
            ? await ResolveTradeUnitAsync(customerId, cancellationToken)
            : await RequireEntitledTradeUnitAsync(request.TradeUnit, cancellationToken);

        var created = await _plantings.CreateAsync(
            customerId,
            customer.Name,
            customer.CustomerCode,
            tradeUnit,
            commodity.Code,
            commodity.PlantingCategory ?? commodity.Category,
            type,
            description: null,
            request.Acres,
            request.PlantingYear,
            cancellationToken);

        _audit.Entity("PlantingIntention", created.Id);
        _audit.After(created);

        var dto = created.ToDto();
        _idempotency.Set(UserKey, request.ClientRequestId, dto);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    [HttpPut("{intentionId:int}")]
    [ProducesResponseType(typeof(PlantingIntentionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PlantingIntentionDto>> Update(long customerId, int intentionId, [FromBody] PlantingIntentionUpdateRequest request, CancellationToken cancellationToken)
    {
        _audit.Entity("PlantingIntention", intentionId);

        if (_idempotency.TryGet<PlantingIntentionDto>(UserKey, request.ClientRequestId, out var replay) && replay is not null)
        {
            return Ok(replay);
        }

        var existing = await _plantings.GetByIdAsync(intentionId, cancellationToken);
        if (existing is null || existing.CustomerId != customerId)
        {
            // Wrong customer is reported exactly like a missing row: no cross-producer probing.
            throw new NotFoundException("PlantingIntention", intentionId);
        }
        _audit.Before(existing);

        if (request.ExpectedModifiedAt is { } expected)
        {
            var actual = existing.ModifiedAt ?? existing.CreatedAt;
            if (Math.Abs((actual - expected).TotalSeconds) >= 1)
            {
                throw new BusinessException(
                    "This planting intention was changed by someone else since you loaded it. Refresh and try again.",
                    "STALE_UPDATE",
                    StatusCodes.Status409Conflict);
            }
        }

        var crop = existing.Crop;
        var category = existing.Category;
        if (!string.IsNullOrWhiteSpace(request.Crop) && !request.Crop.Equals(existing.Crop, StringComparison.OrdinalIgnoreCase))
        {
            var commodity = await ResolveCommodityAsync(request.Crop, cancellationToken);
            crop = commodity.Code;
            category = commodity.PlantingCategory ?? commodity.Category;
        }

        // Type: absent keeps it, empty clears it.
        var type = request.Type is null ? existing.Type : NormaliseType(request.Type);

        // tradeUnit: null keeps the row's trade unit unchanged (mobile does not move intentions between units).
        var updated = await _plantings.UpdateAsync(
            intentionId, crop, category, type, existing.Description, request.Acres, request.PlantingYear ?? existing.PlantingYear,
            tradeUnit: null, cancellationToken)
            ?? throw new NotFoundException("PlantingIntention", intentionId);

        _audit.After(updated);

        var dto = updated.ToDto();
        _idempotency.Set(UserKey, request.ClientRequestId, dto);
        return Ok(dto);
    }

    private async Task<CommodityResponse> ResolveCommodityAsync(string code, CancellationToken cancellationToken)
    {
        var commodities = await _commodities.GetPlantingAsync(cancellationToken);
        return commodities.FirstOrDefault(c => c.IsActive && c.Code.Equals(code.Trim(), StringComparison.OrdinalIgnoreCase))
               ?? throw new ValidationException("crop", "Unknown commodity code. Use a code from /reference/commodities.");
    }

    /// <summary>The desktop's three choices; empty means none. Anything else is rejected rather than stored as free text.</summary>
    private static readonly string[] PlantingTypes = ["Irrigated", "Dryland", "Double Crop"];

    private static string? NormaliseType(string? type)
    {
        if (string.IsNullOrWhiteSpace(type)) return null;
        return PlantingTypes.FirstOrDefault(t => t.Equals(type.Trim(), StringComparison.OrdinalIgnoreCase))
               ?? throw new ValidationException("type", "Type must be Irrigated, Dryland or Double Crop.");
    }

    /// <summary>A trade unit the phone chose: it must be one the caller is entitled to.</summary>
    private async Task<string> RequireEntitledTradeUnitAsync(string tradeUnit, CancellationToken cancellationToken)
    {
        var code = tradeUnit.Trim();
        var allowed = await _entitlements.GetAllowedTradeUnitCodesAsync(cancellationToken);
        return allowed.FirstOrDefault(a => a.Equals(code, StringComparison.OrdinalIgnoreCase))
               ?? throw new ValidationException("tradeUnit", "You don't have access to that trade unit.");
    }

    private async Task<string?> ResolveTradeUnitAsync(long customerId, CancellationToken cancellationToken)
    {
        var customerTradeUnits = await _customers.GetTradeUnitsAsync(customerId, cancellationToken);
        var active = customerTradeUnits.Where(t => t.IsActive).Select(t => t.TradeUnit).ToList();
        if (active.Count == 0) return null;

        // Prefer a trade unit the caller is entitled to; the entitlement filter has already
        // established the customer is reachable, so at least one normally matches.
        var allowed = await _entitlements.GetAllowedTradeUnitCodesAsync(cancellationToken);
        return active.FirstOrDefault(allowed.Contains) ?? active[0];
    }
}
