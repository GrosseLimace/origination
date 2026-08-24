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
/// <para><b>Two different mechanisms, for one reason.</b> Per-producer reads go straight to CTRM live via
/// <see cref="CtrmContractReader"/>, because <c>contracts</c> now takes a <c>customerId</c> and waives the
/// date range when it is supplied — full history, one query, no staleness. The trade-unit-wide pool still
/// comes from <see cref="CtrmContractSnapshot"/>, because there is no equivalent for hundreds of
/// producers at once: <c>customerIds</c> caps at 500, still demands a date range, and supplying a wide
/// one to compensate makes the server exceed its own 30-second timeout. That was measured, not assumed.</para>
///
/// <para>The practical effect is that the producer screen shows live, complete data even though the bulk
/// pool behind it is windowed — the client merges the per-producer response into that pool.</para>
/// </remarks>
public sealed class CtrmContractRepository : IContractRepository
{
    private readonly CtrmContractReader _reader;
    private readonly CtrmContractSnapshot _snapshot;
    private readonly ApplicationDbContext _appContext;
    private readonly ContractRepository _ods;
    private readonly CtrmProvenance _provenance;
    private readonly ILogger<CtrmContractRepository> _logger;

    public CtrmContractRepository(
        CtrmContractReader reader,
        CtrmContractSnapshot snapshot,
        ApplicationDbContext appContext,
        ContractRepository ods,
        CtrmProvenance provenance,
        ILogger<CtrmContractRepository> logger)
    {
        _reader = reader;
        _snapshot = snapshot;
        _appContext = appContext;
        _ods = ods;
        _provenance = provenance;
        _logger = logger;
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

        var read = await _reader.GetForProducerAsync(code, cancellationToken);
        if (!read.Ok)
        {
            _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", read.Status, read.Detail);
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            return [];
        }

        var contracts = Map(read.Value ?? [], onlyOpenOrRecent: true);
        _provenance.RecordContracts("ctrm", "Ok", contracts.Count);

        _logger.LogInformation("CTRM contracts: {Count} for producer {ScoularId} (live, all dates).",
            contracts.Count, code);

        return contracts;
    }

    /// <summary>
    /// Pricing lines for every one of a producer's contracts.
    /// </summary>
    /// <remarks>
    /// Costs no extra network call: CTRM returns pricing lines as a child collection on the contract, and
    /// the reader's short cache means this shares the request the contract list already made.
    /// </remarks>
    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
    {
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code)) return [];

        var read = await _reader.GetForProducerAsync(code, cancellationToken);
        if (!read.Ok) return [];

        return CtrmMappings.ToPricingLines((read.Value ?? []).Where(IsOpenOrRecent));
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

        var read = await _reader.GetForProducerAsync(code, cancellationToken);
        if (!read.Ok)
        {
            _provenance.RecordContracts("ctrm", read.Status.ToString(), 0);
            return [];
        }

        var cutoffYear = DateTime.Today.Year - 1;

        // Mirrors the ODS predicate: a REAL closed date (not the Db2 min-date sentinel) and recent by crop year.
        var contracts = CtrmMappings.ToContracts(
            (read.Value ?? []).Where(d =>
                CtrmMappings.NullIfSentinel(d.ClosedDate) is not null && d.CropYear >= cutoffYear),
            DateTime.Today);

        var ordered = contracts.OrderByDescending(c => c.ContractDate ?? DateTime.MinValue).ToList();
        _provenance.RecordContracts("ctrm", "Ok", ordered.Count);

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
            if (snapshot.Status == CtrmReadStatus.Warming)
                _logger.LogInformation("CTRM contracts: snapshot still warming — {Detail}", snapshot.Detail);
            else
                _logger.LogError("CTRM contracts unavailable [{ErrorCode}] [{ErrorCategory}]: {Status} — {Detail}",
                    "INFRASTRUCTURE_CTRM_UNAVAILABLE", "Infrastructure", snapshot.Status, snapshot.Detail);

            _provenance.RecordContracts("ctrm", snapshot.Status.ToString(), 0);
            return [];
        }

        var contracts = Map(
            snapshot.Contracts.Where(d => scoped.Contains(d.CustomerId?.Trim() ?? string.Empty)),
            onlyOpenOrRecent: true);

        _provenance.RecordContracts("ctrm", snapshot.Truncated ? "OkTruncated" : "Ok", contracts.Count);

        _logger.LogInformation(
            "CTRM contracts: {Count} for {ProducerCount} in-scope producers (window {Window}){Truncated}.",
            contracts.Count, scoped.Count, snapshot.Window, snapshot.Truncated ? ", TRUNCATED" : string.Empty);

        return contracts;
    }

    /// <summary>
    /// Pricing lines for a single contract, from the window snapshot.
    /// </summary>
    /// <remarks>
    /// Cannot use the live reader: this method is keyed by contract id and CTRM offers no contract-number
    /// filter, so there is no way to know which producer to ask for. The producer screen does not use this
    /// path — it fetches pricing lines per customer.
    /// </remarks>
    public async Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var id = sourceContractId?.Trim();
        if (string.IsNullOrEmpty(id)) return [];

        var snapshot = await _snapshot.GetAsync(cancellationToken);
        if (!snapshot.Ok) return [];

        return CtrmMappings.ToPricingLines(snapshot.Contracts.Where(d => Matches(d.ContractId, id)));
    }

    // -------------------------------------------------------------------------
    // Other screens — ODS, because emptying them tests nothing
    // -------------------------------------------------------------------------

    /// <summary>Delegated. Crop year is a different axis from contract date, and there is no crop-year filter.</summary>
    public Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken)
        => DelegateAsync("ByCropYear", _ods.GetByCropYearAsync(cropYear, tradeUnits, cancellationToken));

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

    private async Task<string?> ResolveScoularIdAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(scoularId)) return scoularId.Trim();

        // The customer-to-code mapping is ours, not CTRM's. Resolving it is how we know which producer was
        // asked for — it is not an ODS source for contract content.
        var resolved = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(resolved))
        {
            _logger.LogWarning("CTRM contracts: customer {CustomerId} not found or has no ScoularId.", customerId);
            return null;
        }

        return resolved.Trim();
    }

    /// <summary>
    /// Producer codes in scope: all active producers when no trade unit is selected, otherwise those in
    /// the selected units. Mirrors <see cref="ContractRepository.GetAsync"/> — trade-unit selection is a
    /// narrowing convenience, not an entitlement boundary.
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

    /// <summary>Awaits an ODS-delegated read and records it as ODS-served, so the provenance header
    /// cannot claim CTRM for data ODS actually supplied.</summary>
    private async Task<List<Contract>> DelegateAsync(string reason, Task<List<Contract>> odsRead)
    {
        var contracts = await odsRead;
        _provenance.RecordContracts("ods", $"delegated:{reason}", contracts.Count);
        return contracts;
    }
}
