using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves a producer's tickets from CTRM only, by way of <see cref="CtrmTicketSnapshot"/>.
/// </summary>
/// <remarks>
/// <para><b>Nothing on the producer screen's ticket surface reads ODS.</b> That is the point of this
/// class: the spike exists to establish what CTRM can and cannot supply on its own, so a gap has to
/// render as a gap. Enriching or completing a CTRM result from ODS would make the screen look better
/// while destroying the measurement — you could no longer tell which system produced what.</para>
///
/// <para>Consequences that are deliberate, not defects:</para>
/// <list type="bullet">
/// <item><b>Tickets outside the bill-of-lading window are absent.</b> The window is capped at 366 days
/// by the API and ticket volume outside 2026 is prohibitive, so a 2025 contract's tickets do not
/// appear. An empty list is the honest answer, and it is a finding worth recording.</item>
/// <item><b>Location columns are blank.</b> CTRM returns organization and elevator codes but no place
/// names; those live in the MbpLocationSynonym table on our side.</item>
/// <item><b>Customer-storage gating is not applied.</b> The rule needs active-storage data from
/// <c>ctrm.vw_GNTA39D1</c>, which is ODS-only, so C-prefix tickets are shown ungated.</item>
/// </list>
///
/// <para>Methods serving screens other than the producer profile still delegate to ODS — returning
/// empty there would break Build-A-List and the position report for no benefit to this test.</para>
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
    // CTRM only — the producer screen's ticket surface
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
        if (!snapshot.Ok) return Unavailable(snapshot);

        var tickets = snapshot.Tickets
            .SelectMany(header => CtrmMappings.ToTickets(header, code))
            .OrderByDescending(t => t.Date)
            .ToList();

        _provenance.RecordTickets("ctrm", "Ok", tickets.Count);

        _logger.LogInformation(
            "CTRM tickets: {Count} rows for producer {ScoularId} from the {Window} window ({Cached} tickets cached).",
            tickets.Count, code, snapshot.Window, snapshot.Tickets.Count);

        return tickets;
    }

    /// <inheritdoc />
    /// <remarks>
    /// The same CTRM set narrowed by the contract-number prefix rule the entity itself applies, so the
    /// two tabs cannot disagree about what "unapplied" means.
    /// </remarks>
    public async Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var all = await GetByCustomerAsync(customerId, scoularId, cancellationToken);
        return all.Where(t => !t.IsApplied).ToList();
    }

    /// <summary>
    /// One contract's applied tickets, filtered from the CTRM snapshot.
    /// </summary>
    /// <remarks>
    /// <para>Matched on <c>details.contractNumber</c> across every cached ticket and NOT filtered by
    /// producer: a contract's applied bushels are the sum of all detail rows against it, so filtering by
    /// producer would understate a load split between parties.</para>
    ///
    /// <para>An ODS-indexed variant of this existed briefly — ODS supplying the contract's ticket keys so
    /// the result was complete at any date — and was removed to keep the producer surface CTRM-only.
    /// Bounded by the window, like every other ticket read here.</para>
    ///
    /// <para>Note this method is not currently reached from the producer screen: the client's Applied
    /// Tickets section filters the already-loaded producer ticket list in the browser rather than calling
    /// the API.</para>
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
        if (!snapshot.Ok) return Unavailable(snapshot);

        var tickets = snapshot.Tickets
            .SelectMany(header => CtrmMappings.ToTicketsForContract(header, id))
            .OrderByDescending(t => t.Date)
            .ToList();

        _provenance.RecordTickets("ctrm", "Ok", tickets.Count);

        _logger.LogInformation("CTRM applied tickets: {Count} rows for contract {ContractId}.", tickets.Count, id);

        return tickets;
    }

    // -------------------------------------------------------------------------
    // Other screens — still ODS, because emptying them serves no test
    // -------------------------------------------------------------------------

    /// <summary>Delegated. Trade-unit-wide, and not part of the producer screen's ticket surface.</summary>
    public Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("TradeUnitWide", _ods.GetAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. Feeds the preload/insights surfaces, not the producer profile.</summary>
    public Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("Todays", _ods.GetTodaysAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated. Storage lives in <c>ctrm.vw_GNTA39D1</c> on ODS and CTRM has no storage entity, so this
    /// is an ODS read on both paths. Exposed for callers that gate their own ticket sets; the CTRM
    /// producer read deliberately does NOT apply it.
    /// </summary>
    public Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
        => _ods.GetActiveStorageCommoditiesAsync(customerCodes, cancellationToken);

    /// <inheritdoc />
    public List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
        => _ods.GateCustomerStorageTickets(tickets, storageByCustomer);

    // -------------------------------------------------------------------------

    /// <summary>
    /// Reports an unusable snapshot as an empty result. No ODS fallback: quietly serving ODS rows would
    /// hide the failure and invalidate any conclusion drawn about CTRM's coverage.
    /// </summary>
    private List<Ticket> Unavailable(CtrmTicketSnapshotResult snapshot)
    {
        // Warming is the expected state just after a restart, not a fault.
        if (snapshot.Status == CtrmReadStatus.Warming)
            _logger.LogInformation("CTRM tickets: snapshot still warming — {Detail}", snapshot.Detail);
        else
            _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

        _provenance.RecordTickets("ctrm", snapshot.Status.ToString(), 0);
        return [];
    }

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

        // The customer↔code mapping is ours, not CTRM's — resolving it here is not an ODS data source for
        // ticket content, it is how we know which producer was asked for.
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
}
