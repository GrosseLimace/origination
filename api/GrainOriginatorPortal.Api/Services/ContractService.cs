using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class ContractService : IContractService
{
    private readonly IContractRepository _repository;
    private readonly ILogger<ContractService> _logger;

    public ContractService(IContractRepository repository, ILogger<ContractService> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task<List<ContractResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeContractsAsync(ct => _repository.GetAsync(tradeUnits, ct), "contracts", cancellationToken);

    /// <inheritdoc />
    public Task<List<ContractResponse>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken) =>
        SafeContractsAsync(ct => _repository.GetByCustomerAsync(customerId, scoularId, ct), $"contracts for customer {customerId}", cancellationToken);

    /// <inheritdoc />
    public Task<List<ContractResponse>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken) =>
        SafeContractsAsync(ct => _repository.GetHistoricalForPacingAsync(customerId, ct), $"historical pacing contracts for customer {customerId}", cancellationToken);

    /// <inheritdoc />
    public Task<List<ContractResponse>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeContractsAsync(ct => _repository.GetByCropYearAsync(cropYear, tradeUnits, ct), $"contracts for crop year {cropYear}", cancellationToken);

    /// <inheritdoc />
    public async Task<List<ContractResponse>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
    {
        var contracts = await _repository.GetByFarmAsync(farmId, cancellationToken);
        return contracts.Select(c => c.ToResponse()).ToList();
    }

    /// <inheritdoc />
    public async Task<List<ContractPricingLineResponse>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        try
        {
            var lines = await _repository.GetPricingLinesAsync(sourceContractId, cancellationToken);
            return lines.Select(l => l.ToResponse()).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "vw_ContractPricing not accessible for contract {ContractId}. Returning empty list.", sourceContractId);
            return [];
        }
    }

    /// <inheritdoc />
    public async Task<List<ContractPricingLineResponse>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
    {
        try
        {
            var lines = await _repository.GetPricingLinesByCustomerAsync(scoularId, cancellationToken);
            return lines.Select(l => l.ToResponse()).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "vw_ContractPricing not accessible for customer {CustomerId}. Returning empty list.", scoularId);
            return [];
        }
    }

    /// <summary>
    /// Runs a contract fetch and maps to DTOs, degrading to an empty list when the ODS contract view
    /// is missing a mapped column / object (SQL 207/208) or the DB connection fails — the prior
    /// SqlDataService behavior. Non-database exceptions propagate to the global handler.
    /// </summary>
    private async Task<List<ContractResponse>> SafeContractsAsync(
        Func<CancellationToken, Task<List<Contract>>> fetch, string context, CancellationToken cancellationToken)
    {
        try
        {
            var contracts = await fetch(cancellationToken);
            return contracts.Select(c => c.ToResponse()).ToList();
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            _logger.LogWarning(ex, "Contracts view not accessible or missing a mapped column — returning empty {Context}. SQL {Number}: {Error}",
                context, ex.Number, ex.Message);
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving {Context} — returning empty list", context);
            return [];
        }
    }
}
