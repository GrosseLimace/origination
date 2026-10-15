using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Mobile.Contracts;
using GrainOriginatorPortal.Mobile.Filters;
using GrainOriginatorPortal.Mobile.Mapping;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Mobile.Controllers;

/// <summary>Producer search and detail (cards #641, #642): operations <c>searchCustomers</c> and <c>getCustomer</c>.</summary>
[Route(RoutePrefix + "/customers")]
[RequireTradeUnitEntitlement]
public sealed class MobileCustomersController : MobileControllerBase
{
    private const int DefaultLimit = 25;
    private const int MaxLimit = 50;

    private readonly ICustomerService _customers;
    private readonly IProducerDetailsService _producerDetails;
    private readonly IUserEntitlementService _entitlements;
    private readonly ILogger<MobileCustomersController> _logger;

    public MobileCustomersController(
        ICustomerService customers,
        IProducerDetailsService producerDetails,
        IUserEntitlementService entitlements,
        ILogger<MobileCustomersController> logger)
    {
        _customers = customers;
        _producerDetails = producerDetails;
        _entitlements = entitlements;
        _logger = logger;
    }

    /// <summary>
    /// With <paramref name="q"/>: search producers by name within the caller's entitled trade units.
    /// Without it: browse the producers in the selected (or all entitled) trade units by name, so the
    /// first screen is never empty. Capped either way; this is not the desktop's list-building surface.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<CustomerSummaryDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<CustomerSummaryDto>>> Search(
        [FromQuery] string? q,
        [FromQuery] List<string>? tradeUnits,
        [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        var term = (q ?? string.Empty).Trim();
        if (term.Length is > 0 and < 2)
        {
            throw new ValidationException("q", "Enter at least two characters.");
        }

        var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        // The entitlement filter has already rejected any non-entitled code in tradeUnits (403).
        // With no explicit list, scope to everything the caller is entitled to — never unscoped.
        var scope = tradeUnits is { Count: > 0 }
            ? tradeUnits
            : (await _entitlements.GetAllowedTradeUnitCodesAsync(cancellationToken)).ToList();

        if (scope.Count == 0)
        {
            return Ok(new List<CustomerSummaryDto>());
        }

        var results = term.Length == 0
            ? await _customers.GetAllAsync(scope, cancellationToken)
            : await _customers.SearchAsync(term, scope, cancellationToken);

        return Ok(results
            .Where(c => c.IsActive)
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .Take(take)
            .Select(c => c.ToSummary())
            .ToList());
    }

    /// <summary>Producer header with contacts. Contacts are PII; the client never caches this response.</summary>
    [HttpGet("{customerId:long}")]
    [ProducesResponseType(typeof(CustomerDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CustomerDetailDto>> Get(long customerId, CancellationToken cancellationToken)
    {
        var customer = await _customers.GetByIdAsync(customerId, cancellationToken)
                       ?? throw new NotFoundException("Customer", customerId);

        var details = await TryGetDetailsAsync(customerId, cancellationToken);
        var tradeUnit = await ResolveTradeUnitAsync(customerId, cancellationToken);

        var contacts = details?.Contacts
            .OrderByDescending(c => c.IsPrimary)
            .ThenBy(c => c.SortOrder)
            .Select(c => c.ToContact())
            .ToList() ?? [];

        // Same as the desktop profile: entered contacts, else the legacy primary-contact fields. The producer's
        // own phone and email from the master data travel separately (CustomerDetailDto.Phone/Email) and are
        // shown in addition, never instead.
        if (contacts.Count == 0 && details is not null
            && (!string.IsNullOrWhiteSpace(details.PrimaryContact) || !string.IsNullOrWhiteSpace(details.PrimaryPhone)))
        {
            contacts.Add(new ContactDto
            {
                Name = string.IsNullOrWhiteSpace(details.PrimaryContact) ? "Primary contact" : details.PrimaryContact,
                Phone = details.PrimaryPhone,
                IsPrimary = true,
            });
        }

        return Ok(customer.ToDetail(contacts, tradeUnit));
    }

    /// <summary>
    /// Producer details enrich the header (contacts). They are secondary: if the lookup fails for
    /// any reason the producer page still opens with the customer-level contact. Seen for real on
    /// Dev when the grain-on-farm column rename was applied to the database ahead of this code.
    /// </summary>
    private async Task<ProducerDetailsResponse?> TryGetDetailsAsync(long customerId, CancellationToken cancellationToken)
    {
        try
        {
            return await _producerDetails.GetByCustomerAsync(customerId, cancellationToken);
        }
        catch (NotFoundException)
        {
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex,
                "Producer details unavailable for customer {CustomerId}; serving the header without them. [{ErrorCode}]",
                customerId, "MOBILE_DETAILS_DEGRADED");
            return null;
        }
    }

    private async Task<string?> ResolveTradeUnitAsync(long customerId, CancellationToken cancellationToken)
    {
        var customerTradeUnits = await _customers.GetTradeUnitsAsync(customerId, cancellationToken);
        var active = customerTradeUnits.Where(t => t.IsActive).Select(t => t.TradeUnit).ToList();
        if (active.Count == 0) return null;

        var allowed = await _entitlements.GetAllowedTradeUnitCodesAsync(cancellationToken);
        return active.FirstOrDefault(allowed.Contains) ?? active[0];
    }
}
