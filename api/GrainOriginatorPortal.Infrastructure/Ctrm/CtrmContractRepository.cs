using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves contract reads from CTRM.
/// </summary>
/// <remarks>
/// <para><b>Every read is CTRM, scoped the way ODS scoped it.</b> Per-producer reads go straight to CTRM
/// live via <see cref="CtrmContractReader.GetForProducerAsync"/> - <c>contracts(customerId:)</c> waives the
/// date range, so that is full history in one 1-2s query. Trade-unit-wide reads (the contract list Build-a-List
/// and Actionable Insights filter, and the crop-year list beneath the dashboard) resolve the selected trade
/// units to their producers in Origination and go to <see cref="CtrmContractReader.GetForProducersAsync"/>,
/// exactly as the ODS query resolved producers first and then read their contracts. No date window.</para>
///
/// <para><b>Why the trade-unit read is cached and the per-producer read barely is.</b>
/// <c>contracts(customerIds:)</c> costs ~20-27s cold per 500-producer chunk on the server side (reported to
/// the API owner) - fine once in the background, never on a click. So the producer-set read is held per set
/// and served stale-while-refreshing: an expired copy goes back instantly while the refresh runs behind it.
/// The home-page contract load is what warms it, and it kicks the same producers' ticket read too.</para>
/// </remarks>
public sealed class CtrmContractRepository : IContractRepository
{
    private readonly CtrmContractReader _reader;
    private readonly CtrmTicketReader _ticketReader;
    private readonly ApplicationDbContext _appContext;
    private readonly ContractRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmContractRepository> _logger;
    private readonly CtrmWarmRegistry? _warmRegistry;

    /// <param name="warmRegistry">Optional (absent in tests): records which producer sets the trade-unit
    /// read serves, so <c>CtrmKeepWarmService</c> can keep their caches warm on a cadence.</param>
    public CtrmContractRepository(
        CtrmContractReader reader,
        CtrmTicketReader ticketReader,
        ApplicationDbContext appContext,
        ContractRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmContractRepository> logger,
        CtrmWarmRegistry? warmRegistry = null)
    {
        _reader = reader;
        _ticketReader = ticketReader;
        _appContext = appContext;
        _ods = ods;
        _provenance = provenance;
        _logger = logger;
        _warmRegistry = warmRegistry;
    }

    // -------------------------------------------------------------------------
    // Live per-producer reads
    // -------------------------------------------------------------------------

    /// <summary>
    /// One producer's contracts, read live from CTRM with no date window.
    /// </summary>
    public async Task<List<Contract>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, scoularId, cancellationToken);
        if (code is null)
        {
            _provenance.RecordContracts("ctrm", "NoScoularId", 0);
            return [];
        }

        var read = await _reader.GetForProducerCoreAsync(code, cancellationToken);
        if (!read.Ok)
        {
            // Record before logging so DurationMs is populated: how long CTRM took to fail is the number
            // that separates a fast rejection from a gateway timeout, and it is the more useful of the two.
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
            _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail} (after {DurationMs}ms)",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail, _provenance.ContractsMs);
            return [];
        }

        var contracts = Map(read.Value ?? [], onlyOpenOrRecent: true);
        var fromSet = read.Origin == CtrmReadOrigin.TradeUnitCache;
        _provenance.RecordContracts("ctrm", fromSet ? "OkFromTradeUnitCache" : "Ok", contracts.Count);

        // DurationMs is appended rather than woven into the text on purpose: the turn-on runbook and the
        // App Service log stream both look for the "CTRM contracts: N for producer X" prefix, so it stays
        // intact. It is the only place a slow-but-successful CTRM read becomes queryable — the
        // Server-Timing header carrying the same number is emitted outside Production only.
        //
        // Read it as time-to-answer, not as the CTRM call alone. The provenance stopwatch starts when the
        // request's provenance is created, so this also covers resolving the producer code, which is one
        // indexed lookup against our own database. That is a millisecond or two against a CTRM read
        // measured in seconds, and the same basis the Server-Timing header already reports, so the two
        // agree. If the CTRM segment ever needs isolating, time the reader call itself rather than
        // changing this number's meaning underneath anyone reading it.
        _logger.LogInformation("CTRM contracts: {Count} for producer {ScoularId} ({Source}, all dates) in {DurationMs}ms.",
            contracts.Count, code, fromSet ? "trade-unit cache, live refresh behind it" : "live", _provenance.ContractsMs);

        return contracts;
    }

    /// <summary>
    /// Pricing lines for every one of a producer's contracts.
    /// </summary>
    /// <remarks>
    /// Its OWN network call, deliberately. Pricing lines are a child collection on the contract, and
    /// projecting them roughly doubles a contract page (8.1s against 4.0s per 500 rows), so the contract
    /// list, the pacing card and the ticket read take a core projection without them and this is the only
    /// caller that pays for the full one. It shares nothing with them unless a full read happens to be
    /// cached and fresh, in which case the core callers ride on IT rather than the other way round.
    /// The badges have their own spinner, so nothing on screen blocks on this.
    /// </remarks>
    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code)) return [];

        var read = await _reader.GetForProducerFullAsync(code, cancellationToken);
        if (!read.Ok)
        {
            // Recorded, not just returned empty. This read had no provenance at all, which meant two things:
            // the diagnostics report attributed the previous stage's outcome to it, and - far worse - a
            // failed read blanked the pricing badges with no 503 and no record. Same class of silent
            // wrongness as the applied-ticket hole.
            _logger.LogError("CTRM pricing lines unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
            return [];
        }

        var lines = CtrmMappings.ToPricingLines((read.Value ?? []).Where(IsOpenOrRecent));
        _provenance.RecordContracts("ctrm", "OkPricingLines", lines.Count);
        return lines;
    }

    /// <summary>
    /// Closed historical contracts for the pacing card.
    /// </summary>
    /// <remarks>
    /// This is the read the window could never serve properly. Pacing wants CLOSED contracts for crop year
    /// ≥ last year, and a crop-2025 contract is frequently written months before any sensible contract-date
    /// window opens — so the snapshot systematically understated the year-over-year baseline. A live
    /// per-producer read has no window at all, so the card is now correct rather than merely populated.
    /// </remarks>
    public async Task<List<Contract>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken)
    {
        var code = await ResolveScoularIdAsync(customerId, null, cancellationToken);
        if (code is null)
        {
            _provenance.RecordContracts("ctrm", "NoScoularId", 0);
            return [];
        }

        var read = await _reader.GetForProducerCoreAsync(code, cancellationToken);
        if (!read.Ok)
        {
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
            return [];
        }

        var cutoffYear = DateTime.Today.Year - 1;

        // Mirrors the ODS predicate: a REAL closed date (not the Db2 min-date sentinel) and recent by crop year.
        var contracts = CtrmMappings.ToContracts(
            (read.Value ?? []).Where(d =>
                CtrmMappings.NullIfSentinel(d.ClosedDate) is not null && d.CropYear >= cutoffYear),
            DateTime.Today);

        var ordered = contracts.OrderByDescending(c => c.ContractDate ?? DateTime.MinValue).ToList();
        _provenance.RecordContracts("ctrm",
            read.Origin == CtrmReadOrigin.TradeUnitCache ? "OkFromTradeUnitCache" : "Ok", ordered.Count);

        _logger.LogInformation(
            "CTRM pacing: {Count} closed contracts (crop year >= {Cutoff}) for producer {ScoularId} (live, all dates).",
            ordered.Count, cutoffYear, code);

        return ordered;
    }

    // -------------------------------------------------------------------------
    // Trade-unit-wide pool — still the window snapshot
    // -------------------------------------------------------------------------

    /// <summary>
    /// The trade-unit-wide contract pool the client filters client-side.
    /// </summary>
    /// <remarks>
    /// Kept on the window snapshot deliberately. There is no per-producer equivalent at this scale:
    /// <c>customerIds</c> is capped at 500 entries AND still requires a date range, and a range wide enough
    /// to stand in for "all history" pushes the server past its 30-second timeout — 21 codes already took
    /// 10s. So this stays a windowed bulk read, and the producer screen gets its completeness from the live
    /// per-producer call merged in on top.
    /// </remarks>
    /// <summary>
    /// Every open-or-recent purchase contract for the producers in the selected trade units.
    /// </summary>
    /// <remarks>
    /// <para>The ODS flow aimed at CTRM: trade units resolve to producers in Origination, the producers go to
    /// <see cref="CtrmContractReader.GetForProducersAsync"/>, and the same "open, or crop year within the
    /// last year" clause the ODS query applied is applied here. No date window - a producer's whole history
    /// is in scope, exactly as it was on ODS.</para>
    ///
    /// <para>This is the read the home page makes when the trade-unit selection loads, so it doubles as the
    /// warm-up for the session: the result is cached per producer set and served stale-while-refreshing to
    /// every prompt that follows, and the same producers' TICKETS are kicked off here in the background so
    /// the ticket prompts find them ready too. The first prompt of a session is the only one that can wait,
    /// and only if it beats this call.</para>
    /// </remarks>
    public async Task<List<Contract>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var scoped = await ResolveScopedProducerCodesAsync(tradeUnits, cancellationToken);
        if (scoped.Count == 0)
        {
            _logger.LogInformation("CTRM contracts: no in-scope producers for the selected trade units.");
            _provenance.RecordContracts("ctrm", "NoProducersInScope", 0);
            return [];
        }

        var codes = scoped.ToList();

        // Registered BEFORE the read: even a first, slow walk marks the set as one worth keeping warm.
        _warmRegistry?.Touch(codes, DateTime.UtcNow);

        var read = await _reader.GetForProducersAsync(codes, tradeUnits, cancellationToken);

        // Tickets AFTER contracts, never alongside. Re-measured 2026-09-24 with the batched contract walk:
        // run together, the pair finished no sooner (84 s vs 85 s; 78 s vs 104 s), the contract walk slowed
        // from ~40 s to 65-82 s, and 2 of its 59 batches failed each round (HC0045 timeouts, dropped
        // connections) - the gateway's throughput is fixed and both reads saturate it. The contract list is
        // what the page is waiting on (two Insights cards and every contract prompt), so it goes first and gets
        // the gateway to itself; the tickets warm behind it. (The original 2026-08-27 reason - contract pages
        // were ~25 s list scans - no longer applies; the conclusion does.)
        WarmTicketsInBackground(codes, tradeUnits);

        if (!read.Ok)
        {
            _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
            return [];
        }

        var contracts = Map(read.Value ?? [], onlyOpenOrRecent: true);

        var truncated = read.Status == CtrmReadStatus.PartialSuccess;
        _provenance.RecordContracts("ctrm", truncated ? "OkTruncated" : "Ok", contracts.Count);
        if (truncated) _provenance.RecordPartial();

        _logger.LogInformation(
            "CTRM contracts: {Count} open-or-recent for {ProducerCount} in-scope producer(s) in {TradeUnits} trade unit(s){Truncated}.",
            contracts.Count, scoped.Count, tradeUnits?.Count ?? 0, truncated ? ", TRUNCATED" : string.Empty);

        return contracts;
    }

    /// <summary>
    /// Starts the trade-unit-wide ticket read for these producers without waiting for it.
    /// </summary>
    /// <remarks>
    /// The contract list is requested the moment the trade-unit selection loads; the ticket prompts come
    /// seconds to minutes later and want the same producers. Kicking the read here means it is normally
    /// cached by then. The reader owns the cache and coalesces concurrent callers, so a prompt arriving
    /// mid-walk simply awaits the walk already in progress rather than starting another.
    /// </remarks>
    private void WarmTicketsInBackground(List<string> codes, List<string>? tradeUnits)
    {
        if (_ticketReader.IsWarm(codes)) return;

        var units = tradeUnits?.Count ?? 0;
        _ = _ticketReader.GetForProducersHistoryAsync(codes, CancellationToken.None).ContinueWith(t =>
        {
            if (t.IsFaulted)
                _logger.LogWarning(t.Exception, "CTRM ticket warm-up for {Producers} producer(s) in {TradeUnits} trade unit(s) faulted.", codes.Count, units);
            else if (t.IsCompletedSuccessfully && !t.Result.Ok)
                _logger.LogWarning("CTRM ticket warm-up for {Producers} producer(s) in {TradeUnits} trade unit(s) did not complete: {Status} - {Detail}",
                    codes.Count, units, t.Result.Status, t.Result.Detail);
        }, TaskScheduler.Default);
    }

    /// <summary>
    /// Pricing lines for a single contract. Delegated to ODS.
    /// </summary>
    /// <remarks>
    /// <para>The window snapshot used to answer this, which is why it projected pricing lines. Those
    /// lines doubled the time and payload of every page in an eighteen-page walk (11.6s / 604KB against
    /// 6.1s / 352KB) and that pressure made the server return intermittent HTTP 500s mid-walk, failing
    /// the whole snapshot. So the walk went lean and this went to ODS.</para>
    ///
    /// <para>Cheap to give up: nothing in the UI reaches this. The client method exists with no caller -
    /// the producer screen fetches pricing lines per CUSTOMER, which runs live on CTRM. And <c>contracts</c>
    /// has no contract-number argument, so a live per-contract read is not available anyway.</para>
    /// </remarks>
    public Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
        => DelegateLinesAsync("PricingLinesByContract", _ods.GetPricingLinesAsync(sourceContractId, cancellationToken));

    /// <summary>Same as <see cref="DelegateAsync"/> for a pricing-line read, so the provenance header
    /// still reports where the rows came from.</summary>
    private async Task<List<ContractPricingLine>> DelegateLinesAsync(
        string reason, Task<List<ContractPricingLine>> odsRead)
    {
        var lines = await odsRead;
        _provenance.RecordContracts("ods", $"delegated:{reason}", lines.Count);
        return lines;
    }

    // -------------------------------------------------------------------------
    // Other screens — ODS, because emptying them tests nothing
    // -------------------------------------------------------------------------

    /// <summary>
    /// Purchase contracts for one crop year across the in-scope producers.
    /// </summary>
    /// <remarks>
    /// <para>Live, and no longer delegated. This was on ODS because <c>cropYear</c> was readable but not
    /// filterable; it is now a server-side argument, and paired with <c>customerIds</c> - which waives the
    /// date range - every predicate the ODS query applies is expressible: producer codes, purchase-only,
    /// and the crop year itself.</para>
    ///
    /// <para>No <c>onlyOpenOrRecent</c> narrowing, matching the ODS query, which returns the whole crop
    /// year rather than the open subset. Ordering differs by necessity: ODS sorts on its surrogate id and
    /// CTRM has none, so this falls back to the same contract-date ordering every other CTRM contract read
    /// uses. Deterministic, just not identical.</para>
    /// </remarks>
    /// <summary>
    /// Every purchase contract in one crop year for the producers in the selected trade units.
    /// </summary>
    /// <remarks>
    /// <para>Same producer scope and same cached full-history read as <see cref="GetAsync"/>; the crop year
    /// is filtered here, in memory. That is deliberate. On 2026-08-26 the server's response cache keyed
    /// <c>contracts(customerIds:, cropYear:)</c> without the crop year and handed back 2025 rows for a 2026
    /// request, which is why this read sat on ODS for a day. Not sending <c>cropYear</c> at all means that
    /// class of fault cannot recur here, and the read shares its cache entry with the contract list instead
    /// of paying a second ~25s cold walk per crop year.</para>
    ///
    /// <para>No open-or-recent clause - the ODS crop-year query had none - so closed contracts in the year
    /// are included, which is what the planting-coverage prompts and the crop-year dashboard expect.</para>
    /// </remarks>
    public async Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var scoped = await ResolveScopedProducerCodesAsync(tradeUnits, cancellationToken);
        if (scoped.Count == 0)
        {
            _logger.LogInformation("CTRM contracts: no in-scope producers for crop year {CropYear}.", cropYear);
            _provenance.RecordContracts("ctrm", "NoProducersInScope", 0);
            return [];
        }

        var read = await _reader.GetForProducersAsync(scoped.ToList(), tradeUnits, cancellationToken);
        if (!read.Ok)
        {
            _logger.LogError("CTRM crop-year contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} - {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            _provenance.RecordFailure("contracts", read.Status, read.Detail);
            return [];
        }

        var contracts = Map((read.Value ?? []).Where(d => d.CropYear == cropYear), onlyOpenOrRecent: false);

        _provenance.RecordContracts("ctrm", read.Status == CtrmReadStatus.PartialSuccess ? "OkTruncated" : "Ok", contracts.Count);
        if (read.Status == CtrmReadStatus.PartialSuccess) _provenance.RecordPartial();

        _logger.LogInformation(
            "CTRM contracts: {Count} for crop year {CropYear} across {Producers} in-scope producer(s).",
            contracts.Count, cropYear, scoped.Count);

        return contracts;
    }

    /// <summary>Delegated. CTRM exposes no farm concept.</summary>
    public Task<List<Contract>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>Delegated. No lookup-by-contract-number root field exists.</summary>
    public Task<List<Contract>> GetBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken)
        => DelegateAsync("BySourceId", _ods.GetBySourceIdAsync(sourceContractId, cancellationToken));

    // -------------------------------------------------------------------------

    /// <summary>
    /// Maps DTOs to entities, optionally applying the ODS open-or-recent predicate.
    /// </summary>
    /// <remarks>
    /// The predicate mirrors the ODS WHERE clause so a source comparison shows data differences rather
    /// than differences in our own filtering. Ordered by contract date descending because the ODS path
    /// orders by its surrogate id, which has no CTRM equivalent.
    /// </remarks>
    private static List<Contract> Map(IEnumerable<CtrmContractDto> dtos, bool onlyOpenOrRecent)
    {
        var source = onlyOpenOrRecent ? dtos.Where(IsOpenOrRecent) : dtos;

        return CtrmMappings.ToContracts(source, DateTime.Today)
            .OrderByDescending(c => c.ContractDate ?? DateTime.MinValue)
            .ThenByDescending(c => c.SourceContractId)
            .ToList();
    }

    /// <summary>The ODS clause "ClosedDate IS NULL OR &lt;= sentinel OR CropYear &gt;= year − 1".</summary>
    private static bool IsOpenOrRecent(CtrmContractDto d)
        => CtrmMappings.NullIfSentinel(d.ClosedDate) is null || d.CropYear >= DateTime.Today.Year - 1;

    private static bool Matches(string? value, string code) =>
        string.Equals(value?.Trim(), code, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The producer code this read was asked for. See <see cref="CtrmProducerCode"/>; the mapping is ours,
    /// not CTRM's, and is not an ODS source for contract content.
    /// </summary>
    private Task<string?> ResolveScoularIdAsync(long customerId, string? scoularId, CancellationToken cancellationToken) =>
        CtrmProducerCode.ResolveAsync(_appContext, _logger, "CTRM contracts", customerId, scoularId, cancellationToken);

    /// <summary>
    /// Producer codes in scope: all active producers when no trade unit is selected, otherwise those in
    /// the selected units. Mirrors <see cref="ContractRepository.GetAsync"/> — trade-unit selection is a
    /// narrowing convenience, not an entitlement boundary.
    /// </summary>
    private async Task<HashSet<string>> ResolveScopedProducerCodesAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        // DIFFERS FROM ODS ON PURPOSE. The ODS read treated "no trade unit" as "every active producer" -
        // one SQL query either way. Against CTRM that is 16,763 producers in 34 chunks of a ~25s call:
        // minutes, for a scope no trade unit legitimately has. The only way an empty list reaches here is
        // the entitlement filter stripping every selected unit (the client never asks unscoped), and the
        // honest answer to that is an empty list, not everyone's contracts.
        if (tradeUnits is not { Count: > 0 })
        {
            _logger.LogWarning("CTRM contracts: no trade units in the request (selection empty or removed by the entitlement filter) - returning nothing rather than every producer.");
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        var query = _appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null
                && _appContext.CustomerTradeUnits.Any(ctu =>
                    ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)));

        var codes = await query.Select(c => c.ScoularId!).ToListAsync(cancellationToken);
        return new HashSet<string>(codes.Select(c => c.Trim()), StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Awaits an ODS-delegated read and records it as ODS-served, so the provenance header
    /// cannot claim CTRM for data ODS actually supplied.</summary>
    private async Task<List<Contract>> DelegateAsync(string reason, Task<List<Contract>> odsRead)
    {
        var contracts = await odsRead;
        _provenance.RecordContracts("ods", $"delegated:{reason}", contracts.Count);
        return contracts;
    }
}
