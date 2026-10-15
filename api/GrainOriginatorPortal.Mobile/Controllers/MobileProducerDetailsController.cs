using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Auditing;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Idempotency;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>On-farm details (card #643): operations <c>getProducerDetails</c> and <c>updateProducerDetails</c>.</summary>
[Route(RoutePrefix + "/customers/{customerId:long}/details")]
[RequireTradeUnitEntitlement]
public sealed class MobileProducerDetailsController : MobileControllerBase
{
    private readonly IProducerDetailsService _producerDetails;
    private readonly ICustomerService _customers;
    private readonly IIdempotencyStore _idempotency;
    private readonly IAuditScope _audit;

    public MobileProducerDetailsController(
        IProducerDetailsService producerDetails,
        ICustomerService customers,
        IIdempotencyStore idempotency,
        IAuditScope audit)
    {
        _producerDetails = producerDetails;
        _customers = customers;
        _idempotency = idempotency;
        _audit = audit;
    }

    [HttpGet]
    [ProducesResponseType(typeof(ProducerDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProducerDetailsDto>> Get(long customerId, CancellationToken cancellationToken)
    {
        var current = await TryGetAsync(customerId, cancellationToken);
        if (current is not null)
        {
            return Ok(current.ToProducerDetails());
        }

        // No details row yet is a normal state for a producer nobody has edited; return an empty
        // shell rather than 404 so the edit form can open. The customer itself must exist.
        _ = await _customers.GetByIdAsync(customerId, cancellationToken)
            ?? throw new NotFoundException("Customer", customerId);

        return Ok(new ProducerDetailsDto { CustomerId = customerId, BinSites = [], GrainOnFarm = [] });
    }

    /// <summary>
    /// Updates total acres and, when sent, the bin sites, grain on farm and contacts. Same contract as the
    /// desktop save (since 2026-10-12): a list that is present replaces the stored set; a list that is absent
    /// goes to the service as null, which the repository treats as "not being edited, keep the stored rows".
    /// The phone reads every site and grain field (site key, coordinates, last bid) and sends them back,
    /// so a save cannot erase what the desktop entered. Contacts became editable from the phone on
    /// 2026-10-14 (user: "show and be able to edit additional names, numbers, emails like the desktop").
    /// <c>expectedModifiedAt</c> turns a desktop edit made in between into a 409, not an overwrite.
    /// </summary>
    [HttpPut]
    [ProducesResponseType(typeof(ProducerDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ProducerDetailsDto>> Update(
        long customerId,
        [FromBody] ProducerDetailsUpdateRequest request,
        CancellationToken cancellationToken)
    {
        _audit.Entity("ProducerDetails", customerId);

        if (_idempotency.TryGet<ProducerDetailsDto>(UserKey, request.ClientRequestId, out var replay) && replay is not null)
        {
            return Ok(replay);
        }

        var current = await TryGetAsync(customerId, cancellationToken);
        _audit.Before(current);

        if (request.ExpectedModifiedAt is { } expected && current is not null)
        {
            var actual = current.ModifiedAt ?? current.CreatedAt;
            if (Math.Abs((actual - expected).TotalSeconds) >= 1)
            {
                throw new BusinessException(
                    "These details were changed by someone else since you loaded them. Refresh and try again.",
                    "STALE_UPDATE",
                    StatusCodes.Status409Conflict);
            }
        }

        var customer = current is null
            ? await _customers.GetByIdAsync(customerId, cancellationToken) ?? throw new NotFoundException("Customer", customerId)
            : null;

        var upsert = new UpsertProducerDetailsRequest
        {
            ScoularId = current?.ScoularId ?? customer?.ScoularId,
            CustomerName = current?.CustomerName ?? customer?.Name ?? string.Empty,
            TotalAcres = request.TotalAcres,
            PrimaryContact = current?.PrimaryContact,
            PrimaryPhone = current?.PrimaryPhone,
            Commodities = current?.Commodities,
            LinkedProducerIds = current?.LinkedProducerIds,
            // null = preserve the stored rows (see the summary).
            Contacts = request.Contacts?.Select(c => new ContactItemRequest
            {
                Name = c.Name.Trim(),
                Phone = string.IsNullOrWhiteSpace(c.Phone) ? null : c.Phone.Trim(),
                Email = string.IsNullOrWhiteSpace(c.Email) ? null : c.Email.Trim(),
                IsPrimary = c.IsPrimary,
            }).ToList(),
            BinSites = request.BinSites?.Select(s => new BinSiteItemRequest
            {
                SiteKey = s.SiteKey,
                Name = s.Name.Trim(),
                Capacity = s.Capacity,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
            }).ToList(),
            GrainOnFarm = request.GrainOnFarm?.Select(g => new GrainOnFarmItemRequest
            {
                BinSiteKey = g.BinSiteKey,
                CommodityCode = g.CommodityCode.Trim(),
                BushelsOnHand = g.BushelsOnHand,
                BushelsSold = g.BushelsSold,
                TargetBushels = g.TargetBushels,
                LastBid = g.LastBid,
                Grade = g.Grade,
            }).ToList(),
        };

        var saved = await _producerDetails.UpsertAsync(customerId, upsert, cancellationToken);
        _audit.After(saved);

        var response = saved.ToProducerDetails();
        _idempotency.Set(UserKey, request.ClientRequestId, response);
        return Ok(response);
    }

    private async Task<ProducerDetailsResponse?> TryGetAsync(long customerId, CancellationToken cancellationToken)
    {
        try
        {
            return await _producerDetails.GetByCustomerAsync(customerId, cancellationToken);
        }
        catch (NotFoundException)
        {
            return null;
        }
    }
}
