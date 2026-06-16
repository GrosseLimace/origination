using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class CustomerService : ICustomerService
{
    private readonly ICustomerRepository _repository;
    private readonly ILogger<CustomerService> _logger;

    public CustomerService(ICustomerRepository repository, ILogger<CustomerService> logger)
    {
        _repository = repository;
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
    public async Task<CustomerResponse?> UpdateAsync(long id, string location, string phone, string email,
        List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken)
    {
        var existing = await _repository.GetByIdAsync(id, cancellationToken);
        if (existing is null) return null;

        await _repository.UpdateAsync(id, location, phone, email, farmIds, linkedProducerIds, cancellationToken);

        var refreshed = await _repository.GetByIdAsync(id, cancellationToken);
        return refreshed?.ToResponse();
    }

    /// <inheritdoc />
    public async Task<List<CustomerTradeUnitInfo>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken)
    {
        var memberships = await _repository.GetTradeUnitsAsync(customerId, cancellationToken);
        return memberships.Select(m => m.ToInfo()).ToList();
    }

    /// <inheritdoc />
    public Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken) =>
        _repository.AssignTradeUnitsAsync(customerId, tradeUnitCodes, cancellationToken);

    /// <inheritdoc />
    public Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken) =>
        _repository.DeactivateDormantTradeUnitAsync(customerId, tradeUnit, cancellationToken);

    /// <summary>
    /// Runs a customer list fetch and maps to DTOs, degrading to an empty list on a database error
    /// (the prior SqlDataService behavior). Non-database exceptions propagate to the global handler.
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
            _logger.LogWarning(ex, "DB error retrieving {Context} — returning empty list", context);
            return [];
        }
    }
}
