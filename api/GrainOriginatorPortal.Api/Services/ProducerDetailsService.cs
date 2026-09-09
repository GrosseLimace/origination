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
    public Task DeleteAsync(long customerId, CancellationToken cancellationToken) =>
        _repository.DeleteAsync(customerId, cancellationToken);
}
