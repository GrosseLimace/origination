using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using GrainOriginatorPortal.Api.Exceptions;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class CustomerService : ICustomerService
{
    private readonly ICustomerRepository _repository;
    private readonly IRequestContextService _requestContext;
    private readonly ILogger<CustomerService> _logger;

    public CustomerService(ICustomerRepository repository, IRequestContextService requestContext, ILogger<CustomerService> logger)
    {
        _repository = repository;
        _requestContext = requestContext;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task<List<CustomerResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeListAsync(ct => _repository.GetAsync(tradeUnits, ct), "customers", cancellationToken);

    /// <inheritdoc />
    public Task<List<CustomerResponse>> SearchAsync(string searchTerm, List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeListAsync(ct => _repository.SearchAsync(searchTerm, tradeUnits, ct), "customer search", cancellationToken);

    /// <inheritdoc />
    public Task<List<CustomerResponse>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken) =>
        SafeListAsync(ct => _repository.SearchOdsAsync(searchTerm, ct), "ODS customer search", cancellationToken);

    /// <inheritdoc />
    public Task<List<CustomerResponse>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken) =>
        SafeListAsync(ct => _repository.GetLinkedToAsync(scoularId, ct), "incoming linked customers", cancellationToken);

    /// <inheritdoc />
    public async Task<CustomerResponse?> GetByIdAsync(long id, CancellationToken cancellationToken)
    {
        var customer = await _repository.GetByIdAsync(id, cancellationToken);
        return customer?.ToResponse();
    }

    /// <inheritdoc />
    public async Task<CustomerResponse?> GetByScoularIdAsync(string scoularId, CancellationToken cancellationToken)
    {
        var customer = await _repository.GetByScoularIdAsync(scoularId, cancellationToken);
        return customer?.ToResponse();
    }


    /// <inheritdoc />
    public async Task<List<CustomerTradeUnitInfo>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken)
    {
        var memberships = await _repository.GetTradeUnitsAsync(customerId, cancellationToken);
        return memberships.Select(m => m.ToInfo()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<CustomerTradeUnitInfo>> GetTradeUnitMembershipsAsync(long customerId, CancellationToken cancellationToken)
    {
        var memberships = await _repository.GetTradeUnitMembershipsAsync(customerId, cancellationToken);
        return memberships.Select(m => m.ToInfo()).ToList();
    }

    /// <inheritdoc />
    public Task<AssignTradeUnitsOutcome> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string? scoularId, CancellationToken cancellationToken) =>
        _repository.AssignTradeUnitsAsync(customerId, tradeUnitCodes, scoularId, _requestContext.GetCurrentUser(), cancellationToken);

    /// <inheritdoc />
    public Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken) =>
        _repository.DeactivateDormantTradeUnitAsync(customerId, tradeUnit, _requestContext.GetCurrentUser(), cancellationToken);

    /// <summary>
    /// Runs a customer list fetch and maps to DTOs. Unlike the ODS-backed Ticket/Contract fetches,
    /// there is no "missing view column" case here — Customer is an app-owned table, so any
    /// SqlException reaching this handler (connection failure, timeout, throttling) is a genuine
    /// transient condition. It is rethrown as an InfrastructureException (503) so the client can
    /// distinguish "couldn't load" from a real empty result instead of silently degrading to [].
    /// </summary>
    private async Task<List<CustomerResponse>> SafeListAsync(
        Func<CancellationToken, Task<List<Customer>>> fetch, string context, CancellationToken cancellationToken)
    {
        try
        {
            var customers = await fetch(cancellationToken);
            return customers.Select(c => c.ToResponse()).ToList();
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogError(ex, "Transient DB error retrieving {Context} — surfacing as retryable", context);
            throw new InfrastructureException(
                "The customer data source is temporarily unavailable. Please retry shortly.",
                "CUSTOMERS_DB_UNAVAILABLE", ex, StatusCodes.Status503ServiceUnavailable);
        }
    }
}
