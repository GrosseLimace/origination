using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves a producer's tickets from CTRM by way of <see cref="CtrmTicketSnapshot"/>.
/// </summary>
/// <remarks>
/// <para><b>Discovery is CTRM's, not ODS's.</b> An earlier version of this class asked ODS for a
/// producer's ticket composite keys and then fetched each one from CTRM. It worked, but it left ODS
/// deciding which tickets existed — so a ticket present in CTRM but not yet ingested by ODS was
/// invisible, which is exactly the staleness the move to CTRM is meant to fix. Both applied and
/// unapplied tickets now come from a CTRM bill-of-lading window filtered on
/// <c>details.customerCode</c>.</para>
///
/// <para><b>Two ODS dependencies remain, both deliberate.</b> The customer-storage gate reads active
/// storage from <c>ctrm.vw_GNTA39D1</c>, and location display comes from the MbpLocationSynonym table —
/// CTRM exposes no storage entity and no location names, so neither has anywhere else to come from.
/// Both are enrichment applied to a CTRM-derived set, not a source of tickets.</para>
///
/// <para>The remaining interface methods delegate to ODS: they are trade-unit-wide scans, which the
/// snapshot's producer filter cannot answer.</para>
/// </remarks>
public sealed class CtrmTicketRepository : ITicketRepository
{
    private readonly CtrmTicketSnapshot _snapshot;
    private readonly ApplicationDbContext _appContext;
    private readonly TicketRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmTicketRepository> _logger;

    public CtrmTicketRepository(
        CtrmTicketSnapshot snapshot,
        ApplicationDbContext appContext,
        TicketRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmTicketRepository> logger)
    {
        _snapshot = snapshot;
        _appContext = appContext;
        _ods = ods;
        _provenance = provenance;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Served from CTRM
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    public async Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, scoularId, cancellationToken);
        if (code is null)
        {
            _provenance.RecordTickets("ctrm", "NoScoularId", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            // Warming is the normal state just after a restart, not a fault.
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM tickets: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            // No ODS fallback — serving ODS tickets while the screen is meant to show CTRM would hide the
            // failure and invalidate any comparison drawn from it.
            _provenance.RecordTickets("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var tickets = snapshot.Tickets
            .SelectMany(header => CtrmMappings.ToTickets(header, code))
            .ToList();

        var beforeGate = tickets.Count;
        tickets = await ApplyStorageGateAsync(tickets, code, cancellationToken);
        await _ods.PopulateElevatorLocations(tickets, cancellationToken);

        var ordered = tickets.OrderByDescending(t => t.Date).ToList();

        // The gate can drop rows using ODS storage data, so say when it did — otherwise the count would
        // silently disagree with what CTRM returned.
        var gated = beforeGate != ordered.Count;
        _provenance.RecordTickets("ctrm", gated ? "OkStorageGated" : "Ok", ordered.Count);

        _logger.LogInformation(
            "CTRM tickets: {Count} rows for producer {ScoularId} from the {Window} window ({Retained} tickets cached){Gated}.",
            ordered.Count, code, snapshot.Window, snapshot.Tickets.Count,
            gated ? $", storage gate dropped {beforeGate - ordered.Count}" : string.Empty);

        return ordered;
    }

    /// <inheritdoc />
    /// <remarks>
    /// The same CTRM-derived set, narrowed by the contract-number prefix rule the entity itself applies,
    /// so the two tabs cannot disagree about what "unapplied" means.
    /// </remarks>
    public async Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var all = await GetByCustomerAsync(customerId, scoularId, cancellationToken);
        return all.Where(t => !t.IsApplied).ToList();
    }

    // -------------------------------------------------------------------------
    // Delegated to ODS
    // -------------------------------------------------------------------------

    /// <summary>
    /// Delegated. Trade-unit-wide, so it would need the snapshot filtered against every producer in the
    /// unit at once — a different shape from the per-producer read, and not what the producer screen uses.
    /// </summary>
    public Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("TradeUnitWide", _ods.GetAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated, for the same reason as <see cref="GetAsync"/>.</summary>
    public Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("Todays", _ods.GetTodaysAsync(tradeUnits, cancellationToken));

    /// <summary>
    /// A single contract's applied tickets, served from the CTRM snapshot.
    /// </summary>
    /// <remarks>
    /// This backs the contracts table's row expansion. It matters that it is CTRM-served: the contract row
    /// itself comes from CTRM, so serving its expanded ticket detail from ODS would put two sources inside
    /// one UI element and let the expansion disagree with the row above it.
    ///
    /// Matched on <c>details.contractNumber</c> across every retained ticket rather than on the producer,
    /// because a contract's applied bushels are the sum of all detail rows against it — filtering by
    /// producer would understate the total whenever a load was split between parties.
    /// </remarks>
    public async Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var id = sourceContractId?.Trim();
        if (string.IsNullOrEmpty(id))
        {
            _provenance.RecordTickets("ctrm", "NoContractId", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM applied tickets: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM applied tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            _provenance.RecordTickets("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var tickets = snapshot.Tickets
            .SelectMany(header => CtrmMappings.ToTicketsForContract(header, id))
            .ToList();

        await _ods.PopulateElevatorLocations(tickets, cancellationToken);

        var ordered = tickets.OrderByDescending(t => t.Date).ToList();
        _provenance.RecordTickets("ctrm", "Ok", ordered.Count);

        _logger.LogInformation("CTRM applied tickets: {Count} rows for contract {ContractId}.", ordered.Count, id);

        return ordered;
    }

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated by design rather than as a limitation: storage lives in <c>ctrm.vw_GNTA39D1</c> on ODS
    /// and CTRM has no storage entity, so this is an ODS read on both paths.
    /// </summary>
    public Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
        => _ods.GetActiveStorageCommoditiesAsync(customerCodes, cancellationToken);

    /// <inheritdoc />
    public List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
        => _ods.GateCustomerStorageTickets(tickets, storageByCustomer);

    // -------------------------------------------------------------------------

    /// <summary>
    /// Awaits an ODS-delegated read and records it as ODS-served, so the provenance header cannot claim
    /// CTRM for data ODS actually supplied.
    /// </summary>
    private async Task<List<Ticket>> DelegateAsync(string reason, Task<List<Ticket>> odsRead)
    {
        var tickets = await odsRead;
        _provenance.RecordTickets("ods", $"delegated:{reason}", tickets.Count);
        return tickets;
    }

    private async Task<string?> ResolveScoularIdAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(scoularId)) return scoularId.Trim();

        var resolved = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(resolved))
        {
            _logger.LogWarning("CTRM tickets: customer {CustomerId} not found or has no ScoularId.", customerId);
            return null;
        }

        return resolved.Trim();
    }

    /// <summary>
    /// Applies the customer-storage gate, reusing the ODS implementation.
    /// </summary>
    /// <remarks>
    /// C-prefix tickets linger after the grain is priced out, so one is kept only while the producer still
    /// holds that commodity in active storage. Reused rather than reimplemented: storage is ODS-only
    /// regardless, and a second copy of the rule would be somewhere for the two paths to drift apart.
    /// </remarks>
    private async Task<List<Ticket>> ApplyStorageGateAsync(
        List<Ticket> tickets, string scoularId, CancellationToken cancellationToken)
    {
        var hasStorageTickets = tickets.Exists(t =>
            t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase));

        if (!hasStorageTickets) return tickets;

        var storageByCustomer = await _ods.GetActiveStorageCommoditiesAsync([scoularId], cancellationToken);
        return _ods.GateCustomerStorageTickets(tickets, storageByCustomer);
    }
}
