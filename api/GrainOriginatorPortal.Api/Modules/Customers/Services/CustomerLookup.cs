// Microsoft namespaces
using Microsoft.Data.SqlClient;

// Project namespaces
using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Modules.Customers.Mappings;
using GrainOriginatorPortal.Infrastructure.Modules.Customers.Interfaces;
using GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

namespace GrainOriginatorPortal.Api.Modules.Customers.Services;

/// <inheritdoc cref="ICustomerLookup"/>
public sealed class CustomerLookup(ICustomerRepository repository, ILogger<CustomerLookup> logger) : ICustomerLookup
{
    public Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken) =>
        repository.GetActiveCustomerIdsInTradeUnitsAsync(tradeUnits, cancellationToken);

    public Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken) =>
        repository.GetActiveTradeUnitCodesAsync(customerId, cancellationToken);

    public async Task<CustomerName?> GetNameAsync(long customerId, CancellationToken cancellationToken) =>
        await repository.GetByIdAsync(customerId, cancellationToken) is { } customer
            ? new CustomerName(customer.Name, customer.ScoularId)
            : null;

    public async Task<Dictionary<long, CustomerName>> GetNamesAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken) =>
        (await repository.GetNamesAsync(customerIds, cancellationToken))
            .ToDictionary(c => c.Key, c => new CustomerName(c.Value.Name, c.Value.ScoularId));

    public async Task<List<CustomerResponse>> GetActiveAsync(IReadOnlyCollection<long> customerIds, CancellationToken cancellationToken)
    {
        if (customerIds.Count == 0) return [];
        try
        {
            var customers = await repository.GetActiveByIdsAsync(customerIds, cancellationToken);
            return customers.Select(c => c.ToResponse()).ToList();
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            logger.LogError(ex, "Transient DB error retrieving {Context} — surfacing as retryable", "customers by id");
            throw new InfrastructureException(
                "The customer data source is temporarily unavailable. Please retry shortly.",
                "CUSTOMERS_DB_UNAVAILABLE", ex, StatusCodes.Status503ServiceUnavailable);
        }
    }
}
