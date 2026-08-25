using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves a producer's tickets from CTRM.
/// </summary>
/// <remarks>
/// <para>Per-producer reads go live through <see cref="CtrmTicketReader"/>, using the <c>customerId</c>
/// filter. Unlike contracts, tickets still need a date range — the header carries no customer, so the
/// range is what bounds the scan — which the reader handles by slicing a three-year lookback into
/// consecutive windows within the server's 366-day cap.</para>
///
/// <para><b>Where the ticket rows come from vs. how they are shaped.</b> Every ticket ROW is CTRM. Two
    /// ODS reads are applied on top, and they are required for ODS parity rather than shortcuts: the
    /// customer-storage gate (CTRM has no storage entity) and the elevator/location lookup (CTRM returns
    /// codes, not place names). Both only subtract from or annotate a CTRM-derived set — neither can add a
    /// ticket. The row-level ticket-type and consolidated filters the ODS query applies live in
    /// CtrmMappings, because CTRM exposes no server-side argument for either.</para>
/// </remarks>
public sealed class CtrmTicketRepository : ITicketRepository
{
    private readonly CtrmTicketReader _reader;
    private readonly CtrmContractReader _contractReader;
    private readonly ApplicationDbContext _appContext;
    private readonly TicketRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmTicketRepository> _logger;

    public CtrmTicketRepository(
        CtrmTicketReader reader,
        CtrmContractReader contractReader,
        ApplicationDbContext appContext,
        TicketRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmTicketRepository> logger)
    {
        _reader = reader;
        _contractReader = contractReader;
        _appContext = appContext;
        _ods = ods;
        _provenance = provenance;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Live per-producer reads
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    /// <remarks>
    /// <para>Two independently scoped reads, mirroring the two branches of the ODS ticket query. The
    /// APPLIED branch is scoped by contract number with no customer condition, so a split load - a ticket
    /// applied to this producer's contract but booked under another customer code - is included. The
    /// UNAPPLIED branch is scoped by customer code, because a U/L/C row has no contract to match on.</para>
    ///
    /// <para>This replaced a single customer-scoped read that required BOTH conditions on both branches.
    /// That version could not see a split load, which made the producer's ticket list disagree with the
    /// applied bushels shown against the contract above it - two answers to one question from the same
    /// screen. Measured on QA no producer actually had a split load, so this changes no visible number
    /// today; it removes the way they could diverge unnoticed.</para>
    ///
    /// <para>The two reads run concurrently and are separately cached, so the extra request costs little
    /// wall-clock. Either failing fails the whole answer: a partial list renders as a shorter ticket
    /// history with nothing on screen to say half of it is missing.</para>
    /// </remarks>
    public async Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, scoularId, cancellationToken);
        if (code is null)
        {
            _provenance.RecordTickets("ctrm", "NoScoularId", 0);
            return [];
        }

        // Costs no extra round trip in practice: the contract reader has almost certainly already served
        // this producer's contract list for the screen, so this hits its cache.
        var openPurchaseContractIds = await GetOpenPurchaseContractIdsAsync(code, cancellationToken);

        var appliedRead = _reader.GetForContractsAsync([.. openPurchaseContractIds], cancellationToken);
        var unappliedRead = _reader.GetForProducerAsync(code, cancellationToken);
        await Task.WhenAll(appliedRead, unappliedRead);

        var applied = await appliedRead;
        var unapplied = await unappliedRead;

        if (!applied.Ok || !unapplied.Ok)
        {
            // No ODS fallback: serving ODS tickets while the screen is meant to show CTRM would hide the
            // failure and invalidate any conclusion drawn about CTRM's coverage.
            var failure = !applied.Ok ? applied : unapplied;
            _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", failure.Status, failure.Detail);
            _provenance.RecordTickets("ctrm", failure.Status.ToString(), 0);
            return [];
        }

        // Keyed by id rather than concatenated. The two branches are mutually exclusive by contract-number
        // prefix (a purchase contract id cannot start with U, L or C), so this should never collapse a row
        // - but if that assumption ever broke, a duplicate would double-count the ticket's bushels.
        var byId = new Dictionary<long, Ticket>();

        foreach (var ticket in (applied.Value ?? [])
                 .SelectMany(header => CtrmMappings.ToAppliedForContracts(header, openPurchaseContractIds)))
            byId[ticket.Id] = ticket;

        foreach (var ticket in (unapplied.Value ?? [])
                 .SelectMany(header => CtrmMappings.ToUnappliedForProducer(header, code)))
            byId[ticket.Id] = ticket;

        var tickets = byId.Values.ToList();

        // ODS parity, both steps. The storage gate drops C-prefix tickets whose grain is no longer in
        // active storage, and the location lookup fills the elevator city the ticket views render. Both
        // read ODS because CTRM has neither a storage entity nor place names - so matching ODS behaviour
        // REQUIRES them. They enrich and subtract from a CTRM-derived set; they never add tickets.
        var beforeGate = tickets.Count;
        tickets = await ApplyStorageGateAsync(tickets, code, cancellationToken);
        await _ods.PopulateElevatorLocations(tickets, cancellationToken);

        tickets = tickets.OrderByDescending(t => t.Date).ToList();

        var gated = beforeGate != tickets.Count;
        _provenance.RecordTickets("ctrm", gated ? "OkStorageGated" : "Ok", tickets.Count);

        _logger.LogInformation(
            "CTRM tickets: {Count} rows for producer {ScoularId} (live; {Open} open contract(s)).",
            tickets.Count, code, openPurchaseContractIds.Count);

        return tickets;
    }

    /// <inheritdoc />
    /// <remarks>
    /// The same live set narrowed by the contract-number prefix rule the entity itself applies, so the two
    /// tabs cannot disagree about what "unapplied" means. Shares the reader's cached request rather than
    /// issuing a second one.
    /// </remarks>
    public async Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var all = await GetByCustomerAsync(customerId, scoularId, cancellationToken);
        return all.Where(t => !t.IsApplied).ToList();
    }

    /// <summary>
    /// One contract's applied tickets, read live and scoped on the contract itself.
    /// </summary>
    /// <remarks>
    /// <para>Uses the <c>contractNumbers</c> filter, which scopes on the contract rather than the producer
    /// and so includes a split load - a ticket applied to this contract but booked under a different
    /// customer code. Measured on QA that made no difference for the producers checked, so treat it as
    /// removing an assumption rather than fixing a known defect.</para>
    ///
    /// <para>Previously served from the ticket window snapshot, because no contract filter existed. Reading
    /// live drops the snapshot's configured bill-of-lading window - which silently returned nothing for a
    /// contract whose tickets fell outside it - in favour of the reader's lookback. One contract measures
    /// ~1.7s per window.</para>
    ///
    /// <para>Not reached from the producer screen: the client's Applied Tickets section filters the
    /// already-loaded producer ticket list in the browser rather than calling the API.</para>
    /// </remarks>
    public async Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var id = sourceContractId?.Trim();
        if (string.IsNullOrEmpty(id))
        {
            _provenance.RecordTickets("ctrm", "NoContractId", 0);
            return [];
        }

        var read = await _reader.GetForContractsAsync([id], cancellationToken);
        if (!read.Ok)
        {
            _logger.LogError("CTRM applied tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordTickets("ctrm", read.Status.ToString(), 0);
            return [];
        }

        // Mapped by contract, not by producer: a contract's applied bushels are the sum of every detail row
        // against it, so filtering by producer here would understate a split load's total.
        var tickets = (read.Value ?? [])
            .SelectMany(header => CtrmMappings.ToTicketsForContract(header, id))
            .OrderByDescending(t => t.Date)
            .ToList();

        // ODS parity: its version of this method fills quality and elevator together. Quality arrives
        // inline from CTRM, so only the elevator lookup is left to do.
        await _ods.PopulateElevatorLocations(tickets, cancellationToken);

        _provenance.RecordTickets("ctrm", "Ok", tickets.Count);
        return tickets;
    }

    // -------------------------------------------------------------------------
    // Other screens — ODS
    // -------------------------------------------------------------------------

    /// <summary>Delegated. Trade-unit-wide, not part of the producer screen's ticket surface.</summary>
    public Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("TradeUnitWide", _ods.GetAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. Feeds preload/insights, not the producer profile.</summary>
    public Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("Todays", _ods.GetTodaysAsync(tradeUnits, cancellationToken));

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated by design: storage lives in <c>ctrm.vw_GNTA39D1</c> on ODS and CTRM has no storage
    /// entity. Exposed for callers that gate their own ticket sets; the CTRM producer read does NOT
    /// apply it, so C-prefix tickets show ungated there.
    /// </summary>
    public Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
        => _ods.GetActiveStorageCommoditiesAsync(customerCodes, cancellationToken);

    /// <inheritdoc />
    public List<Ticket> GateCustomerStorageTickets(List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
        => _ods.GateCustomerStorageTickets(tickets, storageByCustomer);

    // -------------------------------------------------------------------------

    /// <summary>
    /// The contract ids of this producer's OPEN purchase contracts, used to scope applied tickets.
    /// </summary>
    /// <remarks>
    /// "Open" mirrors the ODS predicate: no closed date, or the Db2 min-date sentinel standing in for one.
    /// An empty set is a legitimate answer — a producer with no open contracts should show only unapplied
    /// tickets — so a failed contract read is distinguished from an empty one by the reader's status.
    /// </remarks>
    private async Task<HashSet<string>> GetOpenPurchaseContractIdsAsync(string scoularId, CancellationToken cancellationToken)
    {
        var read = await _contractReader.GetForProducerAsync(scoularId, cancellationToken);
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!read.Ok)
        {
            _logger.LogWarning(
                "CTRM tickets: could not read {ScoularId} contracts to scope applied tickets ({Status}) — " +
                "applied tickets will be omitted this pass.", scoularId, read.Status);
            return ids;
        }

        foreach (var c in read.Value ?? [])
        {
            if (CtrmMappings.NullIfSentinel(c.ClosedDate) is not null) continue;   // closed
            var id = c.ContractId?.Trim();
            if (!string.IsNullOrEmpty(id)) ids.Add(id);
        }

        return ids;
    }
    private async Task<List<Ticket>> DelegateAsync(string reason, Task<List<Ticket>> odsRead)
    {
        var tickets = await odsRead;
        _provenance.RecordTickets("ods", $"delegated:{reason}", tickets.Count);
        return tickets;
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
}
