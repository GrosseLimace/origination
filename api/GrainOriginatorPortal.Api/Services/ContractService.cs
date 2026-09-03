using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using GrainOriginatorPortal.Api.Exceptions;

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
    /// Runs a contract fetch and maps to DTOs, degrading to an empty list only when the ODS
    /// contract view is missing a mapped column / object (SQL 207/208) — a permanent schema-drift
    /// condition that a retry cannot fix, the prior SqlDataService behavior. A genuine connection
    /// failure or SQL timeout is DIFFERENT: it is transient and retryable, so it is rethrown as an
    /// InfrastructureException (503) instead of silently degrading to []. Swallowing a timeout to
    /// [] previously made contract-aware Build-A-List prompts (e.g. "producers with active
    /// contracts") render "No Producers Found" with no way for the client to distinguish that from
    /// a genuine zero-match — see the 300s command-timeout comment on the bulk contracts query.
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
            // Anything reaching here is a genuine connection failure, timeout, or throttling —
            // NOT the missing-column/view case (caught above) — so it is transient and worth a
            // retry rather than a silent, indistinguishable-from-real-zero empty list.
            _logger.LogError(ex, "Transient DB error retrieving {Context} — surfacing as retryable", context);
            throw new InfrastructureException(
                "The contract data source is temporarily unavailable. Please retry shortly.",
                "CONTRACTS_DB_UNAVAILABLE", ex, StatusCodes.Status503ServiceUnavailable);
        }
    }
}
