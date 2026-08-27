using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
    private readonly IConfiguration _configuration;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmTicketRepository> _logger;

    public CtrmTicketRepository(
        CtrmTicketReader reader,
        CtrmContractReader contractReader,
        ApplicationDbContext appContext,
        TicketRepository ods,
        IConfiguration configuration,
        CtrmProvenance provenance,
        ILogger<CtrmTicketRepository> logger)
    {
        _reader = reader;
        _contractReader = contractReader;
        _appContext = appContext;
        _ods = ods;
        _configuration = configuration;
        _provenance = provenance;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Live per-producer reads
    // -------------------------------------------------------------------------

    /// <inheritdoc />
    /// <remarks>
    /// <para><b>One read, both classifications.</b> Applied versus unapplied is OUR rule, not a server-side
    /// query - a detail row with a purchase-contract number is applied, one without is not - so it does not
    /// need a query each. A single <c>tickets(customerId:)</c> read returns the producer's ticket headers and
    /// both mappings run over that one set.</para>
    ///
    /// <para><b>Why that matters here more than anywhere else.</b> A ticket read is charged by the DATE SCAN,
    /// not the rows: <c>customerId</c> on <c>tickets</c> is not indexed the way it is on <c>contracts</c>, so
    /// the server must scan ticket headers across the window and semi-join details. Measured 2026-08-27, a
    /// producer with NO tickets at all still costs ~3s for a 365-day window. Three years is three windows, so
    /// a second independently scoped read doubled the scans - six instead of three - and that was the bulk of
    /// a heavy producer's 13.8s load.</para>
    ///
    /// <para><b>What the second read used to add, and why dropping it is safe.</b> It was scoped by contract
    /// number with no customer condition, to catch a split load booked entirely under another customer code.
    /// Note that this single read still catches split loads on any header the producer appears on at all,
    /// because <see cref="CtrmMappings.ToAppliedForContracts"/> matches on the contract number and ignores the
    /// booked code. The only rows it cannot see are on headers with NO detail for this producer. Sampled 90
    /// producers in trade unit 2190 (13 with open contracts) over a full year: zero such rows, and in several
    /// cases this read found MORE applied rows than the contract-scoped one did. Set
    /// <c>Ctrm:CrossBookedAppliedTickets</c> to restore the supplementary read if production data differs -
    /// the code is still here, one setting away.</para>
    ///
    /// <para>A failed read fails the whole answer: a partial list renders as a shorter ticket history with
    /// nothing on screen to say half of it is missing.</para>
    /// </remarks>
    public async Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, scoularId, cancellationToken);
        if (code is null)
        {
            _provenance.RecordTickets("ctrm", "NoScoularId", 0);
            return [];
        }

        // Both started before either is awaited. The ticket read does not depend on the contract read -
        // the open-contract ids are only needed to CLASSIFY the rows once they are back - so awaiting the
        // contracts first made the wall time the sum instead of the max. Usually near-free, because the
        // client requests /contracts/customer and /tickets/customer together and the reads coalesce in the
        // reader's cache, so the contract read has typically landed already; it is worth seconds only when
        // the ticket request wins that race or the contract read is cold and slow.
        var openIdsTask = GetOpenPurchaseContractIdsAsync(code, cancellationToken);
        var readTask = _reader.GetForProducerAsync(code, cancellationToken);

        var read = await readTask;
        if (!read.Ok)
        {
            // No ODS fallback: serving ODS tickets while the screen is meant to show CTRM would hide the
            // failure and invalidate any conclusion drawn about CTRM's coverage.
            _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordTickets("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("tickets", read.Status, read.Detail);

            // Returning here would leave the contract task unobserved; a fault on it would then surface as
            // an unobserved TaskException on the finalizer thread rather than in this request's log.
            Observe(openIdsTask);
            return [];
        }

        var openPurchaseContractIds = await openIdsTask;
        var headers = read.Value ?? [];

        // Opt-in supplement: a second, contract-scoped read that can see a ticket booked entirely under
        // another customer code. Off by default on measured evidence (see the remarks) because it doubles
        // the date scans, which are the whole cost of this read.
        if (ReadBool("Ctrm:CrossBookedAppliedTickets"))
        {
            var crossBooked = await _reader.GetForContractsAsync([.. openPurchaseContractIds], cancellationToken);
            if (!crossBooked.Ok)
            {
                _logger.LogError("CTRM tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", crossBooked.Status, crossBooked.Detail);
                _provenance.RecordTickets("ctrm", crossBooked.Status.ToString(), 0);
                _provenance.RecordFailure("tickets", crossBooked.Status, crossBooked.Detail);
                return [];
            }

            // Same header can arrive from both reads; the id-keyed dictionary below collapses it.
            headers = [.. headers, .. crossBooked.Value ?? []];
        }

        // Keyed by id rather than concatenated. The two mappings are mutually exclusive by contract-number
        // prefix (a purchase contract id cannot start with U, L or C), so this should never collapse a row
        // - but if that assumption ever broke, a duplicate would double-count the ticket's bushels.
        var byId = new Dictionary<long, Ticket>();

        // Both classifications over the SAME headers. ToAppliedForContracts matches on the contract number
        // and ignores the booked customer code, so a split load on a header this producer appears on is
        // still picked up.
        foreach (var ticket in headers.SelectMany(header => CtrmMappings.ToAppliedForContracts(header, openPurchaseContractIds)))
            byId[ticket.Id] = ticket;

        foreach (var ticket in headers.SelectMany(header => CtrmMappings.ToUnappliedForProducer(header, code)))
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
            _provenance.RecordFailure("tickets", read.Status, read.Detail);
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

    /// <summary>
    /// Every ticket for the producers in the selected trade units, from CTRM.
    /// </summary>
    /// <remarks>
    /// <para>The ODS flow aimed at CTRM. Trade units resolve to producers in Origination (the same way the
    /// ODS read resolved them), the producers go to <see cref="CtrmTicketReader.GetForProducersHistoryAsync"/>,
    /// and the same two-branch rule the producer screen uses is applied: applied tickets on the producers'
    /// open purchase contracts, plus unapplied tickets by customer code. Both branches, not just unapplied -
    /// the delivered and unsettled prompts depend on the applied half. Then the storage gate and the
    /// elevator lookup, as on ODS.</para>
    ///
    /// <para>The open-contract set comes from the same cached full-history contract read the contract list
    /// uses, so the two prompts cannot disagree about which contracts are open.</para>
    ///
    /// <para>Timing: both reads are cached per producer set and served stale-while-refreshing, and the
    /// home-page contract load kicks them off, so a prompt normally answers from memory. A cold first prompt
    /// waits on the walk - tens of seconds for a mid-size trade unit - once per session.</para>
    /// </remarks>
    public async Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var codes = await ResolveTradeUnitProducerCodesAsync(tradeUnits, cancellationToken);
        if (codes.Count == 0)
        {
            _provenance.RecordTickets("ctrm", "NoProducersInScope", 0);
            return [];
        }

        // Contracts first, then tickets - not together. The contract pages are ~25s server-side scans and
        // running the ticket walk alongside them starved the contract read past the client timeout (measured
        // 2026-08-27). Contracts are normally already cached by the home-page load, so this costs nothing
        // warm and keeps the server sane cold.
        var contracts = await _contractReader.GetForProducersAsync(codes, cancellationToken);
        var read = await _reader.GetForProducersHistoryAsync(codes, cancellationToken);
        if (!read.Ok)
        {
            _logger.LogError("CTRM trade-unit tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordTickets("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("tickets", read.Status, read.Detail);
            return [];
        }

        var openContractIds = OpenPurchaseContractIds(contracts, codes);
        var codeSet = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);

        // Same two-branch rule as the producer screen, keyed by id so a row cannot be counted twice.
        var byId = new Dictionary<long, Ticket>();
        foreach (var header in read.Value ?? [])
        {
            foreach (var t in CtrmMappings.ToAppliedForContracts(header, openContractIds)) byId[t.Id] = t;
            foreach (var t in CtrmMappings.ToUnappliedForProducers(header, codeSet)) byId[t.Id] = t;
        }

        var tickets = byId.Values.ToList();
        var beforeGate = tickets.Count;
        tickets = await ApplyStorageGateAsync(tickets, codes, cancellationToken);
        await _ods.PopulateElevatorLocations(tickets, cancellationToken);
        tickets = tickets.OrderByDescending(t => t.Date).ToList();

        var truncated = read.Status == CtrmReadStatus.PartialSuccess;
        _provenance.RecordTickets("ctrm",
            truncated ? "OkTruncated" : beforeGate != tickets.Count ? "OkStorageGated" : "Ok", tickets.Count);
        if (truncated) _provenance.RecordPartial();

        _logger.LogInformation(
            "CTRM tickets: {Count} rows for {Producers} producer(s) in {TradeUnits} trade unit(s) ({Open} open contracts){Truncated}.",
            tickets.Count, codes.Count, tradeUnits?.Count ?? 0, openContractIds.Count, truncated ? ", TRUNCATED" : string.Empty);

        return tickets;
    }

    /// <summary>
    /// Producer codes for a trade-unit selection, mirroring the ODS read: no selection means the Spot Loads
    /// resolver (snapshot membership unioned with contract-derived codes); a selection means the
    /// CustomerTradeUnit snapshot alone.
    /// </summary>
    private async Task<List<string>> ResolveTradeUnitProducerCodesAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        // DIFFERS FROM ODS ON PURPOSE - see CtrmContractRepository.ResolveScopedProducerCodesAsync. An
        // empty trade-unit list must not become a 16,763-producer walk.
        if (tradeUnits is not { Count: > 0 })
        {
            _logger.LogWarning("CTRM tickets: no trade units in the request (selection empty or removed by the entitlement filter) - returning nothing rather than every producer.");
            return [];
        }

        var codes = await _appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null
                && _appContext.CustomerTradeUnits.Any(ctu =>
                    ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)))
            .Select(c => c.ScoularId!)
            .ToListAsync(cancellationToken);

        return [.. codes.Select(c => c.Trim()).Distinct(StringComparer.OrdinalIgnoreCase)];
    }

    /// <summary>
    /// Open purchase contract ids for a producer set, from the cached full-history contract read.
    /// </summary>
    /// <remarks>
    /// A failed contract read yields an empty set so the unapplied branch still answers, but the failure is
    /// RECORDED as well as logged: without the applied half, the delivery and unsettled prompts would
    /// report only unapplied rows and look like a complete answer.
    /// </remarks>
    private HashSet<string> OpenPurchaseContractIds(CtrmReadResult<List<CtrmContractDto>> contracts, IReadOnlyCollection<string> codes)
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!contracts.Ok)
        {
            _logger.LogError("CTRM trade-unit contracts unavailable for the applied-ticket branch [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", contracts.Status, contracts.Detail);
            _provenance.RecordFailure("contracts", contracts.Status, contracts.Detail);
            return ids;
        }

        var codeSet = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);
        foreach (var c in contracts.Value ?? [])
        {
            if (!string.Equals(c.ContractPrefixType?.Trim(), CtrmMappings.PurchasePrefix, StringComparison.OrdinalIgnoreCase)) continue;
            if (CtrmMappings.NullIfSentinel(c.ClosedDate) is not null) continue;
            if (c.CustomerId is null || !codeSet.Contains(c.CustomerId.Trim())) continue;
            var id = c.ContractId?.Trim();
            if (!string.IsNullOrEmpty(id)) ids.Add(id);
        }
        return ids;
    }

    /// <summary>
    /// Recent unapplied tickets across the in-scope producers. Live. Backs Spot Loads.
    /// </summary>
    /// <remarks>
    /// <para>Named "Todays" for history; the ODS query it replaces uses a 30-DAY cutoff and this matches
    /// it. Unapplied only, because Spot Loads discards applied tickets - so this asks for one window by
    /// customer code and keeps the U/L/C rows, exactly as the ODS version does.</para>
    ///
    /// <para><b>Why this one is affordable when the trade-unit-wide ticket read is not.</b> The cost of a
    /// ticket query is the header SCAN, not the rows: measured across 88 producers, one day returned 0
    /// rows in 11.6s, thirty days returned 76 rows in 6.1s. A narrow window is therefore nearly free
    /// compared to a wide one, and 30 days is a single request per 500-producer chunk. The same query
    /// over three years is 26,529 rows for those producers - roughly a thousand pages at full scale -
    /// which is why GetAsync stays on ODS.</para>
    ///
    /// <para>Storage tickets are included and then gated, matching ODS: C-prefix loads should appear here
    /// exactly as they do on the producer page.</para>
    /// </remarks>
    public async Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        // DIFFERS FROM ODS ON PURPOSE - see ResolveTradeUnitProducerCodesAsync. The ODS resolver reads an
        // empty list as every active producer; against CTRM that was measured at 34 chunks and ~90s for 43
        // rows, triggered by the entitlement filter stripping the selected unit.
        if (tradeUnits is not { Count: > 0 })
        {
            _logger.LogWarning("CTRM tickets: Spot Loads asked with no trade units (selection empty or removed by the entitlement filter) - returning nothing rather than every producer.");
            _provenance.RecordTickets("ctrm", "NoTradeUnitsSelected", 0);
            return [];
        }

        // The ODS implementation, not a copy of it. It unions the CustomerTradeUnit snapshot with
        // contract-derived codes, and missing that union silently drops producers from Spot Loads.
        var codes = await _ods.ResolveSpotLoadProducerCodesAsync(tradeUnits, cancellationToken);
        if (codes.Count == 0)
        {
            _logger.LogInformation("CTRM tickets: no in-scope producers for the selected trade units.");
            _provenance.RecordTickets("ctrm", "NoProducersInScope", 0);
            return [];
        }

        // Matches the ODS cutoff exactly. The extra day on the far end is headroom for clock skew
        // against the Db2 host, the same allowance the per-producer windows make.
        // The ODS query bounds this on ONE side only - TicketBlDate >= cutoff, with no upper limit - so a
        // forward-dated bill of lading appears there. CTRM requires both ends, so the far end reaches a
        // week ahead rather than to today: enough for realistic forward-dating, and nearly free because the
        // cost of a ticket query is the scan rather than the span (30 days measured at 6.1s, one day at
        // 11.6s). A ticket dated further out than this would still show on ODS and not here.
        var from = DateTime.UtcNow.Date.AddDays(-RecentTicketDays);
        var to = DateTime.UtcNow.Date.AddDays(ForwardTicketDays);

        var read = await _reader.GetForProducersAsync(codes, from, to, cancellationToken);
        if (!read.Ok)
        {
            _logger.LogError("CTRM recent tickets unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordTickets("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("tickets", read.Status, read.Detail);
            return [];
        }

        // Unapplied only, scoped per producer. A detail row carries its own customer code, so the set is
        // partitioned by code rather than filtered once - a header can hold rows for several producers.
        // Set-based, deliberately. Calling the single-producer mapper once per code rescans every detail
        // row once per producer, and there are several hundred producers in scope.
        var codeSet = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);

        var tickets = (read.Value ?? [])
            .SelectMany(header => CtrmMappings.ToUnappliedForProducers(header, codeSet))
            .ToList();

        var beforeGate = tickets.Count;
        tickets = await ApplyStorageGateAsync(tickets, codes, cancellationToken);

        // Deliberately NO elevator or quality enrichment, matching ODS: Spot Loads displays neither,
        // and skipping them drops one to three round trips per read.
        tickets = tickets.OrderByDescending(t => t.Date).ToList();

        _provenance.RecordTickets("ctrm", beforeGate != tickets.Count ? "OkStorageGated" : "Ok", tickets.Count);

        _logger.LogInformation(
            "CTRM recent tickets: {Count} unapplied rows across {Producers} producer(s), last {Days} days.",
            tickets.Count, codes.Count, RecentTicketDays);

        return tickets;
    }

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated by design: storage lives in <c>ctrm.vw_GNTA39D1</c> on ODS and CTRM has no storage
    /// entity. Exposed for callers that gate their own ticket sets. Note the CTRM producer read DOES gate -
    /// <see cref="ApplyStorageGateAsync"/> runs in <see cref="GetByCustomerAsync"/> - so C-prefix tickets
    /// are filtered there exactly as on ODS; an earlier version of this comment said otherwise.
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
    ///
    /// A failure here is RECORDED, not just logged. Without that the endpoint answers 200 with every
    /// applied ticket missing, which reads as "this producer has delivered nothing against their
    /// contracts" - the exact class of silent wrongness the failure plumbing exists to prevent. It became a
    /// realistic combination once the contract and ticket reads started running concurrently: "contracts
    /// timed out, tickets did not" no longer implies the ticket read failed too.
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
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
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
    private Task<List<Ticket>> ApplyStorageGateAsync(
        List<Ticket> tickets, string scoularId, CancellationToken cancellationToken)
        => ApplyStorageGateAsync(tickets, [scoularId], cancellationToken);

    /// <remarks>
    /// The storage lookup is only made when a C-prefix ticket is actually present, and only for the
    /// producers in scope — it reads <c>ctrm.vw_GNTA39D1</c>, which is slow enough that a producer with no
    /// storage should not pay for it.
    /// </remarks>
    private async Task<List<Ticket>> ApplyStorageGateAsync(
        List<Ticket> tickets, IReadOnlyCollection<string> scoularIds, CancellationToken cancellationToken)
    {
        var hasStorageTickets = tickets.Exists(t =>
            t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase));

        if (!hasStorageTickets) return tickets;

        // Narrowed to the producers that actually have a C-prefix ticket rather than everyone in scope.
        // On a trade-unit-wide read that is the difference between a handful of codes and several hundred.
        var storageCodes = tickets
            .Where(t => t.CtrmContractNumber is { Length: > 0 } cn
                        && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)
                        && !string.IsNullOrEmpty(t.CustomerCode))
            .Select(t => t.CustomerCode!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (storageCodes.Count == 0) return tickets;

        var storageByCustomer = await _ods.GetActiveStorageCommoditiesAsync(storageCodes, cancellationToken);
        return _ods.GateCustomerStorageTickets(tickets, storageByCustomer);
    }

    /// <summary>
    /// Days of history the recent-ticket read covers. Defaults to the ODS cutoff it replaces.
    /// </summary>
    /// <remarks>
    /// Configurable only because 30 days makes this unverifiable in nonprod: dev CTRM has no ticket
    /// activity in the last 30 days for the real producer population (the same ten producers return 0 over
    /// 30 days and 834 over a year), so Spot Loads reads empty whichever source backs it. Widening the
    /// window is the only way to prove the path end to end without waiting for data to arrive. Leave it at
    /// 30 in any environment whose output is being compared against ODS - a wider window here is not a
    /// parity difference in the data, but it IS a difference in the question being asked.
    /// </remarks>
    private int RecentTicketDays => Math.Max(1, ReadInt("Ctrm:RecentTicketDays", 30));

    /// <summary>
    /// Days past today the recent-ticket window reaches, to catch a forward-dated bill of lading.
    /// </summary>
    /// <remarks>
    /// Exists only because CTRM requires both ends of a range and the ODS query it mirrors bounds only the
    /// near end. Not configurable: it is a correctness allowance, not a tuning dial, and widening it eats
    /// into the server's 366-day cap on the whole range.
    /// </remarks>
    private const int ForwardTicketDays = 7;

    private int ReadInt(string key, int fallback) =>
        int.TryParse(_configuration[key]?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    /// <summary>
    /// Attaches a logging continuation to a task this method is abandoning, so a fault on it is reported
    /// here instead of arriving later as an unobserved task exception.
    /// </summary>
    private void Observe<T>(Task<T> task) =>
        _ = task.ContinueWith(
            t => _logger.LogWarning(t.Exception, "CTRM: an abandoned per-producer contract read faulted."),
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

    /// <summary>Reads a boolean setting; absent or unparseable means false.</summary>
    private bool ReadBool(string key) =>
        bool.TryParse(_configuration[key]?.Trim(), out var parsed) && parsed;

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
