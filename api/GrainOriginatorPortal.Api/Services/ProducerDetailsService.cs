using GrainOriginatorPortal.Api.Models.Requests;
using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Api.Exceptions;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class ProducerDetailsService : IProducerDetailsService
{
    private readonly IProducerDetailsRepository _repository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IUserEntitlementService _entitlementService;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<ProducerDetailsService> _logger;

    public ProducerDetailsService(
        IProducerDetailsRepository repository,
        ICustomerRepository customerRepository,
        IUserEntitlementService entitlementService,
        IDisplayNameLookupRepository displayNameLookup,
        IRequestContextService requestContext,
        ILogger<ProducerDetailsService> logger)
    {
        _repository = repository;
        _customerRepository = customerRepository;
        _entitlementService = entitlementService;
        _displayNameLookup = displayNameLookup;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<List<ProducerDetailsResponse>> GetAllAsync(CancellationToken cancellationToken)
    {
        List<ProducerDetails> all;
        IReadOnlyDictionary<string, string> nameMap;
        try
        {
            all = await _repository.GetAllAsync(cancellationToken);
            nameMap = await _displayNameLookup.ResolveAsync(
                all.Select(p => p.CreatedBy).Concat(all.Select(p => p.ModifiedBy ?? string.Empty)),
                cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            // ProducerDetails is an app table that should always exist, so a SqlException here is
            // a genuine transient condition (connection failure, timeout, throttling) — not a
            // permanent schema mismatch. Rethrown as an InfrastructureException (503) instead of a
            // silent empty list: swallowing this previously zeroed out every grain-on-farm prompt
            // plus the acres/bin-capacity/primary-contact refines with no signal to the user.
            // A non-SQL exception here is unexpected and propagates to the global handler as a 500
            // — that's a real bug, not a condition a retry should paper over.
            _logger.LogError(ex, "Transient DB error retrieving ProducerDetails — surfacing as retryable");
            throw new InfrastructureException(
                "The producer detail data source is temporarily unavailable. Please retry shortly.",
                "PRODUCER_DETAILS_DB_UNAVAILABLE", ex, StatusCodes.Status503ServiceUnavailable);
        }

        // Entitlement scoping: narrow to producers in the caller's allowed trade units.
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);
        // Fail closed: if entitlements are unavailable and uncached, refuse rather than returning
        // data we can't authorize (CWE-285). Mirrors EnforceTradeUnitAccessAttribute.
        if (!_entitlementService.EntitlementsAvailable)
            throw new GrainOriginatorPortal.Api.Exceptions.InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);
        var allowedCustomerIds = await _customerRepository.GetActiveCustomerIdsInTradeUnitsAsync(allowed, cancellationToken);
        all = all.Where(d => allowedCustomerIds.Contains(d.CustomerId)).ToList();

        return all.Select(p => p.ToResponse(nameMap)).ToList();
    }

    /// <inheritdoc />
    public async Task<ProducerDetailsResponse> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        // Scoped, and NOT an AR-02 route any more (removed 2026-09-14). AR-02's rationale is
        // cross-trade-unit coverage, and no client path depends on it here: this read fires only
        // from selectCustomer, whose producer always comes from the entitled roster — both
        // filteredCustomers sources start from customers(), deep links resolve via
        // customers().find() and give up rather than widening, and the cross-TU linked-producer
        // cache feeds only the last-contact badge, never a selectable row.
        //
        // Contrast GET /api/notes/customer/{id}, which IS fetched for every linked-group member
        // including producers outside the selected trade units. That one stays under AR-02 on
        // purpose. The criterion is whether a real client path needs the cross-TU read, not the
        // shape of the route.
        await EnsureCustomerEntitledAsync(customerId, "read", cancellationToken);

        var pd = await _repository.GetAsync(customerId, cancellationToken);
        if (pd is null)
            return new ProducerDetailsResponse { CustomerId = customerId };

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { pd.CreatedBy, pd.ModifiedBy ?? string.Empty }, cancellationToken);
        return pd.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<ProducerDetailsResponse> UpsertAsync(long customerId, UpsertProducerDetailsRequest request, CancellationToken cancellationToken)
    {
        // Deliberately unscoped; see SECURITY-REVIEWS/ACCEPTED-RISKS.md (AR-01). Unlike the sibling
        // DeleteAsync below, this one has live cross-trade-unit callers: home.component.ts writes
        // producer details to LINKED producers outside the caller's selected trade units, and the
        // onboarding flow saves details immediately after assigning membership. An entitlement
        // check here would break both — do not add one without re-opening AR-01.
        var grainEntries = (request.GrainOnFarm ?? [])
            .Select(g => new GrainOnFarmEntry
            {
                CommodityGroup = g.CommodityGroup,
                BushelsOnHand = g.BushelsOnHand,
                TargetBushels = g.TargetBushels,
                Grade = g.Grade
            })
            .ToList();

        // Null contacts (old client) stays null — the repository preserves existing rows then.
        var contactEntries = request.Contacts?
            .Select((c, index) => new ProducerContactEntry
            {
                Name = c.Name,
                Phone = c.Phone,
                Email = c.Email,
                IsPrimary = c.IsPrimary,
                SortOrder = index
            })
            .ToList();

        var saved = await _repository.UpsertAsync(new ProducerDetailsUpsertArgs
        {
            CustomerId = customerId,
            ScoularId = request.ScoularId,
            CustomerName = request.CustomerName,
            TotalAcres = request.TotalAcres,
            BinCapacity = request.BinCapacity,
            PrimaryContact = request.PrimaryContact,
            PrimaryPhone = request.PrimaryPhone,
            Commodities = request.Commodities,
            LinkedProducerIds = request.LinkedProducerIds,
            GrainOnFarm = grainEntries,
            Contacts = contactEntries
        }, _requestContext.GetCurrentUser(), cancellationToken);

        var nameMap = await _displayNameLookup.ResolveAsync(
            new[] { saved.CreatedBy, saved.ModifiedBy ?? string.Empty }, cancellationToken);
        return saved.ToResponse(nameMap);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(long customerId, CancellationToken cancellationToken)
    {
        // H-062 (CWE-639). This route carries no trade-unit value, so [EnforceTradeUnitAccess]
        // could not guard it even if the controller applied the filter — it only reads a
        // `tradeUnits` list, a `tradeUnitKey`, or a [FromBody] DTO carrying TradeUnitKey, and a
        // DELETE by customer id exposes none of those. The check therefore lives here.
        //
        // Deliberately NOT covered by AR-01, which still covers the sibling PUT. Three things
        // separate the delete: it has no client caller at all (deleteProducerDetails in
        // api.service.ts is dead code), it hand-cascades to ProducerContacts and
        // ProducerGrainOnFarm, and the producer contact/grain-on-farm rows it destroys are
        // hand-entered with no upstream system of record to restore from. AR-01's collaboration
        // rationale protects a hand-off workflow that does not exist on this route.
        await EnsureCustomerEntitledAsync(customerId, "delete", cancellationToken);

        return await _repository.DeleteAsync(customerId, cancellationToken);
    }

    /// <summary>Throws unless the caller is entitled to a trade unit the customer belongs to.
    /// <para>
    /// Two databases answer this: TradeUnitPreferences says which trade units the USER holds
    /// (<c>UserTradeUnitPreferences</c>), and the Origination DB says which customers sit in them
    /// (<c>CustomerTradeUnit</c>, active rows only). A producer with no active membership row
    /// therefore resolves as not-entitled — safe here because every client path reaches these
    /// routes with a producer already in the entitled roster, which by construction has one.
    /// </para><para>
    /// Fails CLOSED with 503 on a TradeUnitPreferences outage rather than acting on data it cannot
    /// authorize (CWE-285), mirroring GetAllAsync and EnforceTradeUnitAccessAttribute. Without that
    /// branch an outage would empty the allowed set and turn every call into a 403.
    /// </para></summary>
    private async Task EnsureCustomerEntitledAsync(long customerId, string operation, CancellationToken cancellationToken)
    {
        var allowed = await _entitlementService.GetAllowedTradeUnitCodesAsync(cancellationToken);

        if (!_entitlementService.EntitlementsAvailable)
            throw new InfrastructureException(
                "Authorization data is temporarily unavailable. Please retry shortly.",
                "ENTITLEMENTS_DB_UNAVAILABLE", StatusCodes.Status503ServiceUnavailable);

        var allowedCustomerIds = await _customerRepository.GetActiveCustomerIdsInTradeUnitsAsync(allowed, cancellationToken);
        if (allowedCustomerIds.Contains(customerId)) return;

        _logger.LogWarning(
            "Producer details {Operation} denied [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId} User={User}",
            operation, "AUTHORIZATION_FORBIDDEN", "Authorization", customerId, _requestContext.GetCurrentUser());
        throw new ForbiddenException(
            "Access denied: you are not authorized for this producer's trade unit(s).");
    }
}
