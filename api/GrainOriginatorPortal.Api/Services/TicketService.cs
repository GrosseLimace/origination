using GrainOriginatorPortal.Api.Models.Responses;
using GrainOriginatorPortal.Api.Services.Mappings;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;

namespace GrainOriginatorPortal.Api.Services;

/// <inheritdoc />
public class TicketService : ITicketService
{
    private readonly ITicketRepository _repository;
    private readonly ILogger<TicketService> _logger;

    public TicketService(ITicketRepository repository, ILogger<TicketService> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetAllAsync(List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetAsync(tradeUnits, ct), "tickets", cancellationToken);

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetTodaysAsync(tradeUnits, ct), "today's tickets", cancellationToken);

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetByCustomerAsync(customerId, scoularId, ct), $"tickets for customer {customerId}", cancellationToken);

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetUnappliedByCustomerAsync(customerId, scoularId, ct), $"unapplied tickets for customer {customerId}", cancellationToken);

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetAppliedByContractAsync(sourceContractId, ct), $"applied tickets for contract {sourceContractId}", cancellationToken);

    /// <inheritdoc />
    public Task<List<TicketResponse>> GetByFarmAsync(string farmId, CancellationToken cancellationToken) =>
        SafeFetchAsync(ct => _repository.GetByFarmAsync(farmId, ct), $"tickets for farm {farmId}", cancellationToken);

    /// <summary>
    /// Runs a ticket fetch and maps to DTOs, degrading to an empty list when the ODS ticket view is
    /// missing a mapped column / object (SQL 207/208), the DB connection fails, or EF hits a mapping
    /// mismatch — the same graceful behavior the prior SqlDataService provided so a missing Dev view
    /// doesn't 500 the page. Non-database exceptions propagate to the global handler.
    /// </summary>
    private async Task<List<TicketResponse>> SafeFetchAsync(
        Func<CancellationToken, Task<List<Ticket>>> fetch, string context, CancellationToken cancellationToken)
    {
        try
        {
            var tickets = await fetch(cancellationToken);
            return tickets.Select(t => t.ToResponse()).ToList();
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            _logger.LogWarning(ex, "Tickets view not accessible or missing a mapped column — returning empty {Context}. SQL {Number}: {Error}",
                context, ex.Number, ex.Message);
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving {Context} — returning empty list", context);
            return [];
        }
        catch (Exception ex) when (ex is InvalidCastException or InvalidOperationException or OverflowException)
        {
            _logger.LogWarning(ex, "EF Core mapping error retrieving {Context} (ODS schema mismatch?) — returning empty list", context);
            return [];
        }
    }
}
