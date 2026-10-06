using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Routes ticket reads to either the ODS or the CTRM repository based on <c>Ctrm:Source</c>.
/// </summary>
/// <remarks>
/// Reads the flag on every call, matching <see cref="ContractRepositorySwitch"/>, so the source can be
/// flipped without restarting the API. Anything other than the literal <c>ctrm</c> means ODS.
/// </remarks>
public sealed class TicketRepositorySwitch : ITicketRepository
{
    private readonly TicketRepository _ods;
    private readonly CtrmTicketRepository _ctrm;
    private readonly IConfiguration _configuration;
    private readonly CtrmProvenance _provenance;

    public TicketRepositorySwitch(
        TicketRepository ods,
        CtrmTicketRepository ctrm,
        IConfiguration configuration,
        CtrmProvenance provenance)
    {
        _ods = ods;
        _ctrm = ctrm;
        _configuration = configuration;
        _provenance = provenance;
    }

    /// <summary>True when ticket reads are currently pointed at CTRM.</summary>
    public bool UsingCtrm => string.Equals(
        _configuration["Ctrm:Source"]?.Trim(),
        ContractRepositorySwitch.CtrmSourceValue,
        StringComparison.OrdinalIgnoreCase);

    /// <summary>The repository this call routes to, recording the choice for the provenance header.</summary>
    private ITicketRepository Active
    {
        get
        {
            var useCtrm = UsingCtrm;
            _provenance.RecordSource(useCtrm ? ContractRepositorySwitch.CtrmSourceValue : "ods");
            return useCtrm ? _ctrm : _ods;
        }
    }

    public Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => Active.GetAsync(tradeUnits, cancellationToken);

    public Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => Active.GetTodaysAsync(tradeUnits, cancellationToken);

    public Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
        => Active.GetByCustomerAsync(customerId, scoularId, cancellationToken);

    public Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
        => Active.GetUnappliedByCustomerAsync(customerId, scoularId, cancellationToken);

    public Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken)
        => Active.GetAppliedByContractAsync(sourceContractId, cancellationToken);

    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => Active.GetByFarmAsync(farmId, cancellationToken);

    public Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
        => Active.GetActiveStorageCommoditiesAsync(customerCodes, cancellationToken);

    public List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
        => Active.GateCustomerStorageTickets(tickets, storageByCustomer);
}
