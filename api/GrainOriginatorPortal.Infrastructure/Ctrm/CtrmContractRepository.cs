using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Serves contract reads from CTRM by way of <see cref="CtrmContractSnapshot"/>, delegating the
/// reads CTRM cannot satisfy to the ODS repository.
/// </summary>
/// <remarks>
/// <para>Four of the eight interface methods are served from CTRM — the ones behind the producer
/// screen. The rest delegate, each for a concrete reason documented at the method. Delegating rather
/// than throwing matters: a partially-implemented repository would take down unrelated screens the
/// moment the flag was flipped.</para>
///
/// <para>Trade-unit and producer scoping still runs through the app database, exactly as the ODS
/// path does. CTRM has no customer or trade-unit filter, and the customer↔trade-unit mapping is
/// ours, not CTRM's — so ODS resolves *which* producers to show and CTRM supplies their contracts.</para>
/// </remarks>
public sealed class CtrmContractRepository : IContractRepository
{
    private readonly CtrmContractSnapshot _snapshot;
    private readonly ApplicationDbContext _appContext;
    private readonly ContractRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmContractRepository> _logger;

    public CtrmContractRepository(
        CtrmContractSnapshot snapshot,
        ApplicationDbContext appContext,
        ContractRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmContractRepository> logger)
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

    /// <summary>
    /// Trade-unit-wide contract pool. Resolves the in-scope producer codes from the app DB, then
    /// filters the CTRM window snapshot to them.
    /// </summary>
    public async Task<List<Contract>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var scoped = await ResolveScopedProducerCodesAsync(tradeUnits, cancellationToken);
        if (scoped.Count == 0)
        {
            _logger.LogInformation("CTRM contracts: no in-scope producers for the selected trade units.");
            _provenance.RecordContracts("ctrm", "NoProducersInScope", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            // Deliberately NOT falling back to ODS. Silently serving ODS rows while the screen is
            // supposed to be showing CTRM would make the two sources impossible to tell apart and
            // would hide exactly the failure this spike needs to see. Empty plus a recorded reason.
            // Warming is expected right after a restart, not a fault — log it as information so a
            // startup window does not read as an outage in the logs.
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM contracts: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            _provenance.RecordContracts("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var contracts = MapInScope(snapshot, d => scoped.Contains(d.CustomerId?.Trim() ?? string.Empty));

        _provenance.RecordContracts("ctrm", snapshot.Truncated ? "OkTruncated" : "Ok", contracts.Count);

        _logger.LogInformation(
            "CTRM contracts: {Count} for {ProducerCount} in-scope producers (window {Window}, {Fetched} of {Total} fetched{Truncated}).",
            contracts.Count, scoped.Count, snapshot.Window, snapshot.Contracts.Count, snapshot.TotalCountInWindow,
            snapshot.Truncated ? ", TRUNCATED" : string.Empty);

        return contracts;
    }

    /// <summary>
    /// One producer's contracts. <paramref name="scoularId"/> is the Scoular customer code and maps
    /// straight onto CTRM's <c>customerId</c> — the same namespace, verified byte-for-byte.
    /// </summary>
    public async Task<List<Contract>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code))
        {
            // The ODS path can fall back to its surrogate CustomerId here; CTRM knows nothing about
            // that key, so without the code there is no way to ask the question.
            _logger.LogWarning("CTRM contracts: no ScoularId for customer {CustomerId} — cannot query CTRM by surrogate id.",
                customerId);
            _provenance.RecordContracts("ctrm", "NoScoularId", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            // No ODS fallback — see the note in GetAsync.
            // Warming is expected right after a restart, not a fault — log it as information so a
            // startup window does not read as an outage in the logs.
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM contracts: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            _provenance.RecordContracts("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var contracts = MapInScope(snapshot, d => Matches(d.CustomerId, code));

        _provenance.RecordContracts("ctrm", snapshot.Truncated ? "OkTruncated" : "Ok", contracts.Count);

        _logger.LogInformation("CTRM contracts: {Count} for producer {ScoularId} (window {Window}).",
            contracts.Count, code, snapshot.Window);

        return contracts;
    }

    /// <summary>Pricing lines for a single contract, taken from the snapshot.</summary>
    public async Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var id = sourceContractId?.Trim();
        if (string.IsNullOrEmpty(id)) return [];

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok) return [];

        return CtrmMappings.ToPricingLines(snapshot.Contracts.Where(d => Matches(d.ContractId, id)));
    }

    /// <summary>
    /// Pricing lines for every one of a producer's contracts. CTRM returns these as a child
    /// collection on the contract, so unlike the ODS path there is no separate query — and
    /// <c>freightAdjustment</c> arrives on the line rather than needing a second lookup against
    /// <c>base.ContractPrice</c>.
    /// </summary>
    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code)) return [];

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok) return [];

        return CtrmMappings.ToPricingLines(
            snapshot.Contracts.Where(d => Matches(d.CustomerId, code) && IsOpenOrRecent(d)));
    }

    // -------------------------------------------------------------------------
    // Delegated to ODS — each for a reason CTRM cannot currently overcome
    // -------------------------------------------------------------------------

    /// <summary>
    /// Served from CTRM, which in practice means near-empty — and that is the intended answer.
    /// </summary>
    /// <remarks>
    /// The Contract Pacing card sits on the producer profile, so it must not read ODS while the rest of
    /// that screen is on CTRM. It wants *closed* contracts for crop year ≥ last year, and the snapshot is
    /// a contract-DATE window: a crop-2025 contract is frequently written months before the window opens,
    /// so most of the pacing baseline is simply not in the window.
    ///
    /// Reporting that honestly as a thin card is the point. Filling it from ODS would make the screen look
    /// complete while hiding a real limitation, and nothing else on the page would agree with it.
    /// </remarks>
    public async Task<List<Contract>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken)
    {
        var scoularId = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(scoularId))
        {
            _provenance.RecordContracts("ctrm", "NoScoularId", 0);
            return [];
        }

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok)
        {
            _provenance.RecordContracts("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var pacingCutoffYear = DateTime.Today.Year - 1;

        // Mirrors the ODS predicate: CLOSED (a real closed date, not the sentinel) and recent by crop year.
        var contracts = CtrmMappings.ToContracts(
            snapshot.Contracts.Where(d =>
                Matches(d.CustomerId, scoularId.Trim())
                && CtrmMappings.NullIfSentinel(d.ClosedDate) is not null
                && d.CropYear >= pacingCutoffYear),
            DateTime.Today);

        var ordered = contracts.OrderByDescending(c => c.ContractDate ?? DateTime.MinValue).ToList();
        _provenance.RecordContracts("ctrm", "Ok", ordered.Count);

        _logger.LogInformation(
            "CTRM pacing: {Count} closed contracts (crop year >= {Cutoff}) for producer {ScoularId} in window {Window}. " +
            "Expect this to understate history — the window filters on contract date, not crop year.",
            ordered.Count, pacingCutoffYear, scoularId, snapshot.Window);

        return ordered;
    }

    /// <summary>
    /// Delegated. Crop year is a different axis from contract date — a 2026 window contains
    /// contracts from several crop years and misses most of any one of them.
    /// </summary>
    public Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("ByCropYear", _ods.GetByCropYearAsync(cropYear, tradeUnits, cancellationToken));

    /// <summary>Delegated. CTRM exposes no farm concept; <c>FarmId</c> has no source there at all.</summary>
    public Task<List<Contract>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
        => DelegateAsync("ByFarm", _ods.GetByFarmAsync(farmId, cancellationToken));

    /// <summary>
    /// Delegated. There is no lookup-by-contract-number root field, so serving this from CTRM would
    /// only work for contracts that happen to fall inside the current window — succeeding or failing
    /// depending on configuration, which is worse than consistently using ODS.
    /// </summary>
    public Task<List<Contract>> GetBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken)
        => DelegateAsync("BySourceId", _ods.GetBySourceIdAsync(sourceContractId, cancellationToken));

    /// <summary>
    /// Awaits an ODS-delegated read and records it as ODS-served.
    /// </summary>
    /// <remarks>
    /// Without this the provenance header would claim <c>ctrm</c> for a read that ODS actually
    /// answered, purely because the CTRM repository was the one routed to. That is precisely the
    /// mistake the header exists to prevent, and it would be the most misleading kind: confidently
    /// wrong about the thing being measured.
    /// </remarks>
    private async Task<List<Contract>> DelegateAsync(string reason, Task<List<Contract>> odsRead)
    {
        var contracts = await odsRead;
        _provenance.RecordContracts("ods", $"delegated:{reason}", contracts.Count);
        return contracts;
    }

    // -------------------------------------------------------------------------

    /// <summary>Maps the snapshot rows matching <paramref name="predicate"/>, newest first.</summary>
    /// <remarks>
    /// The open-or-recent filter mirrors the ODS queries' WHERE clause. Without it the CTRM path
    /// would include long-closed contracts the ODS path excludes, and every ODS-vs-CTRM comparison
    /// would show differences caused by our own filtering rather than by source data.
    /// Ordering is by contract date descending because the ODS path orders by its surrogate
    /// <c>ContractId</c>, which is roughly insertion order and has no CTRM equivalent.
    /// </remarks>
    private static List<Contract> MapInScope(CtrmSnapshotResult snapshot, Func<CtrmContractDto, bool> predicate)
    {
        var matching = snapshot.Contracts.Where(d => predicate(d) && IsOpenOrRecent(d));
        var contracts = CtrmMappings.ToContracts(matching, DateTime.Today);

        return contracts
            .OrderByDescending(c => c.ContractDate ?? DateTime.MinValue)
            .ThenByDescending(c => c.SourceContractId)
            .ToList();
    }

    /// <summary>
    /// The ODS clause "ClosedDate IS NULL OR ClosedDate &lt;= sentinel OR CropYear &gt;= year − 1",
    /// applied to a CTRM row.
    /// </summary>
    private static bool IsOpenOrRecent(CtrmContractDto d)
    {
        var closed = CtrmMappings.NullIfSentinel(d.ClosedDate);
        return closed is null || d.CropYear >= DateTime.Today.Year - 1;
    }

    private static bool Matches(string? value, string code) =>
        string.Equals(value?.Trim(), code, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Resolves the producer codes in scope, mirroring <see cref="ContractRepository.GetAsync"/>:
    /// all active producers when no trade unit is selected, otherwise those in the selected units.
    /// Trade-unit selection is a narrowing convenience, not an entitlement boundary.
    /// </summary>
    private async Task<HashSet<string>> ResolveScopedProducerCodesAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var hasTradeUnitFilter = tradeUnits is { Count: > 0 };

        var query = _appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null);

        if (hasTradeUnitFilter)
            query = query.Where(c => _appContext.CustomerTradeUnits.Any(ctu =>
                ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits!.Contains(ctu.TradeUnit)));

        var codes = await query.Select(c => c.ScoularId!).ToListAsync(cancellationToken);

        return new HashSet<string>(codes.Select(c => c.Trim()), StringComparer.OrdinalIgnoreCase);
    }
}
