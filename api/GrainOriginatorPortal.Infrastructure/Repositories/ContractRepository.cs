using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class ContractRepository : IContractRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<ContractRepository> _logger;

    public ContractRepository(OriginationDbContext context, ApplicationDbContext appContext, ILogger<ContractRepository> logger)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<List<Contract>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        // vw_CurrentContracts joined to thousands of producer IDs via STRING_SPLIT can run
        // well over the default 30s on larger environments (QA, prod). A timeout here causes
        // the inner exception handler to return [] which makes "All producers with contracts"
        // and other contract-aware queries silently come back empty. Same 300s ceiling we use
        // on the tickets bulk; the call still runs once per TU change, not per click.
        _context.Database.SetCommandTimeout(300);

        var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

        // Two-path strategy. Both paths now use STRING_SPLIT downstream so we never hit
        // SQL Server's 2100-parameter IN-clause limit even when the unfiltered path returns
        // thousands of producer IDs.
        List<Contract> contracts;

        if (!hasTradeUnitFilter)
        {
            // Unfiltered: every active producer in dbo.Customer. Trade unit selection is a
            // narrowing convenience, not an entitlement boundary — when nothing is selected
            // the user can search across the full producer base.
            var customerCtrmIds = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null)
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            if (customerCtrmIds.Count == 0)
            {
                contracts = [];
            }
            else
            {
                var ctrmIdsCsv = SanitizeCsv(customerCtrmIds);
                contracts = await _context.Contracts
                    .FromSqlInterpolated($@"
                        SELECT c.* FROM base.vw_CurrentContracts c
                        INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                            ON c.CtrmCustomerId = ids.value
                        WHERE c.IsActive = 1 AND c.ContractPrefixType = 'P'
                          AND (c.ClosedDate IS NULL OR c.ClosedDate <= {OdsConstants.OpenClosedDateSentinel} OR c.CropYear >= {DateTime.Today.Year - 1})")
                    .AsNoTracking()
                    .OrderByDescending(c => c.Id)
                    .ToListAsync(cancellationToken);
            }
        }
        else
        {
            // Step 1: get producer customer IDs from dbo.Customer (app DB, fast indexed lookup),
            // scoped to the selected trade units via dbo.CustomerTradeUnit. The new schema is
            // one-row-per-customer so no further dedup is needed.
            var ctrmIds = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.ScoularId != null && c.IsActive
                    && _appContext.CustomerTradeUnits.Any(ctu =>
                        ctu.CustomerId == c.Id
                        && ctu.IsActive
                        && tradeUnits!.Contains(ctu.TradeUnit)))
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            if (ctrmIds.Count == 0)
            {
                contracts = [];
            }
            else
            {
                // Step 2: load contracts for those producer customers.
                // STRING_SPLIT passes IDs as a single CSV parameter instead of 200+ individual
                // parameters — avoids the slow IN-clause plan on vw_CurrentContracts where
                // CtrmCustomerId has no index.
                var ctrmIdsCsv = SanitizeCsv(ctrmIds);
                contracts = await _context.Contracts
                    .FromSqlInterpolated($@"
                        SELECT c.* FROM base.vw_CurrentContracts c
                        INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                            ON c.CtrmCustomerId = ids.value
                        WHERE c.IsActive = 1 AND c.ContractPrefixType = 'P'
                          AND (c.ClosedDate IS NULL OR c.ClosedDate <= {OdsConstants.OpenClosedDateSentinel} OR c.CropYear >= {DateTime.Today.Year - 1})")
                    .AsNoTracking()
                    .OrderByDescending(c => c.Id)
                    .ToListAsync(cancellationToken);
            }
        }

        _logger.LogInformation("Loaded {ContractCount} contracts for customers who have contracts or tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
            contracts.Count, hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

        // Open contracts may carry the 0001-01-01 sentinel instead of NULL — normalize to
        // null so the frontend and downstream code treat them as open.
        NormalizeOpenClosedDates(contracts);

        // Calculate status and set defaults for fields not in ODS view
        var today = DateTime.Today;
        foreach (var contract in contracts)
        {
            contract.Status = CalculateContractStatus(contract, today);
            contract.Signed = true; // Default to signed since ODS doesn't have this field
        }

        await EnrichWithHedgeMarketMonthAsync(contracts, cancellationToken);
        return contracts;
    }

    public async Task<List<Contract>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
        // Resolve ScoularId if not supplied by the caller (avoids a DB round-trip when the client already has it).
        if (string.IsNullOrEmpty(scoularId))
        {
            scoularId = await _appContext.Customers.AsNoTracking()
                .Where(c => c.Id == customerId)
                .Select(c => c.ScoularId)
                .FirstOrDefaultAsync(cancellationToken);
            if (string.IsNullOrEmpty(scoularId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId", customerId);
                return [];
            }
        }

        // Match contracts: open contracts + prior-year (for pacing comparison)
        var pacingCutoffYear = DateTime.Today.Year - 1;
        var contracts = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId == scoularId
                && (c.ClosedDate == null || c.ClosedDate <= OdsConstants.OpenClosedDateSentinel || c.CropYear >= pacingCutoffYear))
            .OrderByDescending(c => c.Id)
            .ToListAsync(cancellationToken);

        // Open contracts may carry the 0001-01-01 sentinel — normalize to null.
        NormalizeOpenClosedDates(contracts);

        // Calculate status and set defaults for fields not in ODS view
        var today = DateTime.Today;
        foreach (var contract in contracts)
        {
            contract.Status = CalculateContractStatus(contract, today);
            contract.Signed = true; // Default to signed since ODS doesn't have this field
        }

        await EnrichWithHedgeMarketMonthAsync(contracts, cancellationToken);
        _logger.LogInformation("Found {ContractCount} contracts for customer {CustomerId} (ScoularId: {ScoularId})",
            contracts.Count, customerId, scoularId);
        return contracts;
    }

    public async Task<List<Contract>> GetHistoricalForPacingAsync(long customerId, CancellationToken cancellationToken)
    {
        var scoularId = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrEmpty(scoularId))
        {
            _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId — returning empty historical contracts", customerId);
            return [];
        }

        var pacingCutoffYear = DateTime.Today.Year - 1;
        var contracts = await _context.Contracts
            .FromSqlInterpolated($@"
                SELECT c.* FROM base.Contract c
                WHERE c.IsActive = 1
                  AND c.IsDeleted = 0
                  AND c.ContractPrefixType = 'P'
                  AND c.CtrmCustomerId = {scoularId}
                  AND c.ClosedDate IS NOT NULL AND c.ClosedDate > {OdsConstants.OpenClosedDateSentinel}
                  AND c.CropYear >= {pacingCutoffYear}")
            .AsNoTracking()
            .OrderByDescending(c => c.Id)
            .ToListAsync(cancellationToken);

        var today = DateTime.Today;
        foreach (var contract in contracts)
        {
            contract.Status = CalculateContractStatus(contract, today);
            contract.Signed = true;
        }

        _logger.LogInformation("Loaded {Count} historical closed contracts for pacing (customer {CustomerId}, cutoff {Cutoff})",
            contracts.Count, customerId, pacingCutoffYear);
        return contracts;
    }

    public async Task<List<Contract>> GetByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        // Resolve producer CtrmCustomerIds from dbo.Customer, optionally scoped to TUs
        // via dbo.CustomerTradeUnit. Trade unit selection is a narrowing convenience,
        // not an entitlement boundary — when nothing is selected we return contracts
        // for every active producer.
        var ctrmIdsQuery = _appContext.Customers
            .AsNoTracking()
            .Where(c => c.IsActive && c.ScoularId != null);
        if (tradeUnits != null && tradeUnits.Count > 0)
        {
            ctrmIdsQuery = ctrmIdsQuery.Where(c => _appContext.CustomerTradeUnits.Any(ctu =>
                ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)));
        }
        var ctrmIds = await ctrmIdsQuery
            .Select(c => c.ScoularId!)
            .ToListAsync(cancellationToken);

        if (ctrmIds.Count == 0) return [];

        var ctrmIdsCsv = SanitizeCsv(ctrmIds);
        var contracts = await _context.Contracts
            .FromSqlInterpolated($@"
                SELECT c.* FROM base.Contract c
                INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                    ON c.CtrmCustomerId = ids.value
                WHERE c.IsActive = 1
                  AND c.IsDeleted = 0
                  AND c.ContractPrefixType = 'P'
                  AND c.CropYear = {cropYear}")
            .AsNoTracking()
            .OrderByDescending(c => c.Id)
            .ToListAsync(cancellationToken);

        // Normalize the 0001-01-01 open-sentinel to null so open/closed reads correctly.
        NormalizeOpenClosedDates(contracts);

        var today = DateTime.Today;
        foreach (var contract in contracts)
        {
            contract.Status = CalculateContractStatus(contract, today);
            contract.Signed = true;
        }

        _logger.LogInformation("Loaded {Count} base.Contract rows for crop year {CropYear} (tradeUnitCount: {TuCount})",
            contracts.Count, cropYear, tradeUnits?.Count ?? 0);
        return contracts;
    }

    public Task<List<Contract>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
    {
        // Note: FarmId is not mapped in the current DbContext configuration
        // Returning empty list until proper mapping is established
        _logger.LogWarning("Contract.FarmId is not mapped - returning empty list for farm {FarmId}", farmId);
        return Task.FromResult(new List<Contract>());
    }

    public async Task<List<Contract>> GetBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var contracts = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.SourceContractId == sourceContractId && c.ContractPrefixType == "P")
            .ToListAsync(cancellationToken);

        var today = DateTime.Today;
        foreach (var contract in contracts)
            contract.Status = CalculateContractStatus(contract, today);

        return contracts;
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        var lines = await _context.ContractPricingLines
            .AsNoTracking()
            .Where(p => p.ContractId == sourceContractId)
            .OrderBy(p => p.PriceSequence)
            .ToListAsync(cancellationToken);
        await EnrichFreightAdjustmentAsync(lines, cancellationToken);
        return lines;
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken)
    {
        // base.vw_ContractPricing has no customer_id column — resolve via contracts
        var sourceContractIds = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.CtrmCustomerId == scoularId && c.ContractPrefixType == "P")
            .Select(c => c.SourceContractId)
            .Where(id => id != null)
            .ToListAsync(cancellationToken);

        if (sourceContractIds.Count == 0)
            return new List<ContractPricingLine>();

        var lines = await _context.ContractPricingLines
            .AsNoTracking()
            .Where(p => sourceContractIds.Contains(p.ContractId))
            .OrderBy(p => p.ContractId)
            .ThenBy(p => p.PriceSequence)
            .ToListAsync(cancellationToken);
        await EnrichFreightAdjustmentAsync(lines, cancellationToken);
        return lines;
    }

    /// <summary>Populates <see cref="ContractPricingLine.FreightAdjustment"/> from base.ContractPrice,
    /// matched on (SourceContractId, PriceSequence). The view supplies the curated rows; this only
    /// enriches them (left-join semantics — no row is added or dropped), so it stays safe even though
    /// vw_ContractPricing does not expose FreightAdjustment.</summary>
    private async Task EnrichFreightAdjustmentAsync(List<ContractPricingLine> lines, CancellationToken cancellationToken)
    {
        if (lines.Count == 0) return;

        var contractIds = lines.Select(l => l.ContractId).Distinct().ToList();
        var freight = await _context.ContractPriceFreightAdjustments
            .AsNoTracking()
            .Where(f => f.SourceContractId != null && f.PriceSequence != null
                && contractIds.Contains(f.SourceContractId) && f.FreightAdjustment != null)
            .Select(f => new { f.SourceContractId, f.PriceSequence, f.FreightAdjustment })
            .ToListAsync(cancellationToken);
        if (freight.Count == 0) return;

        ApplyFreightAdjustments(lines,
            freight.Select(f => (f.SourceContractId, f.PriceSequence, f.FreightAdjustment)).ToList());
    }

    /// <summary>Merges freight-adjustment rows (from base.ContractPrice) onto the curated pricing lines
    /// (from the view), matched on (SourceContractId, PriceSequence). The base column may be CHAR-padded,
    /// so it is trimmed before matching against the line's already-trimmed ContractId. Pure (no DB) so
    /// the matching rules are unit-testable.</summary>
    public static void ApplyFreightAdjustments(
        List<ContractPricingLine> lines,
        IReadOnlyList<(string? SourceContractId, int? PriceSequence, decimal? FreightAdjustment)> freight)
    {
        if (lines.Count == 0 || freight.Count == 0) return;

        var bySeq = freight
            .Where(f => f.SourceContractId != null && f.PriceSequence != null && f.FreightAdjustment != null)
            .GroupBy(f => (Id: f.SourceContractId!.Trim(), Seq: f.PriceSequence!.Value))
            .ToDictionary(g => g.Key, g => g.First().FreightAdjustment);

        foreach (var line in lines)
            if (line.PriceSequence != null
                && bySeq.TryGetValue((line.ContractId, line.PriceSequence.Value), out var fa))
                line.FreightAdjustment = fa;
    }

    /// <summary>
    /// Normalizes the 0001-01-01 "open" sentinel to null so the frontend's `!closedDate`
    /// check and all downstream C# `== null` tests treat these contracts as open. Call
    /// after materializing contracts from the ODS.
    /// </summary>
    private static void NormalizeOpenClosedDates(IEnumerable<Contract> contracts)
    {
        foreach (var c in contracts)
            if (c.ClosedDate.HasValue && c.ClosedDate.Value <= OdsConstants.OpenClosedDateSentinel)
                c.ClosedDate = null;
    }

    private static ContractStatus CalculateContractStatus(Contract contract, DateTime today)
    {
        // NOTE: Fulfilled status requires ticket data to calculate delivery progress
        // Once tickets are available, check if 100% delivered and return Fulfilled

        // Check delivery period dates
        if (contract.DeliveryStart.HasValue && contract.DeliveryEnd.HasValue)
        {
            // If today is before delivery period starts, it's pending
            if (today < contract.DeliveryStart.Value)
            {
                return ContractStatus.Pending;
            }

            // If today is within the delivery period, it's active
            if (today >= contract.DeliveryStart.Value && today <= contract.DeliveryEnd.Value)
            {
                return ContractStatus.Active;
            }

            // If delivery period has passed, it's overdue (until we can verify fulfillment via tickets)
            if (today > contract.DeliveryEnd.Value)
            {
                return ContractStatus.Overdue;
            }
        }

        // Default to pending for contracts without delivery dates
        return ContractStatus.Pending;
    }

    private sealed class ContractHedgeRow
    {
        public long ContractId { get; set; }
        public string? HedgeMarketMonthDescription { get; set; }
        public string? PriceMarketMonthDescription { get; set; }
    }

    /// <summary>
    /// Pulls HedgeMarketMonthDescription / PriceMarketMonthDescription from base.Contract for
    /// the given contracts and assigns them onto the instances. These columns aren't exposed
    /// via vw_CurrentContracts, so the main fetch can't include them — this side-query
    /// fills the gap. Silently swallows DB errors so a missing column on the underlying
    /// table never breaks the contracts endpoint.
    /// </summary>
    private async Task EnrichWithHedgeMarketMonthAsync(List<Contract> contracts, CancellationToken cancellationToken)
    {
        if (contracts.Count == 0) return;
        try
        {
            var ids = contracts.Select(c => c.Id.ToString()).ToList();
            // SanitizeIdentifierCsv strips SQL metacharacters as defense-in-depth, but the value is
            // also passed as an explicit SqlParameter so it is never concatenated into the SQL text
            // (M-015 — matches the parameterized pattern used by every other raw query in Infrastructure).
            var idsCsv = SanitizeIdentifierCsv(ids);
            var rows = await _context.Database
                .SqlQueryRaw<ContractHedgeRow>(
                    @"SELECT c.ContractId, c.HedgeMarketMonthDescription, c.PriceMarketMonthDescription
                       FROM base.Contract c
                       INNER JOIN STRING_SPLIT(@ids, ',') ids ON c.ContractId = TRY_CAST(ids.value AS bigint)",
                    new SqlParameter("@ids", idsCsv))
                .ToListAsync(cancellationToken);
            var byId = rows.ToDictionary(r => r.ContractId);
            foreach (var c in contracts)
            {
                if (byId.TryGetValue(c.Id, out var row))
                {
                    c.HedgeMarketMonthDescription = row.HedgeMarketMonthDescription;
                    c.PriceMarketMonthDescription = row.PriceMarketMonthDescription;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to enrich contracts with HedgeMarketMonth — continuing without it");
        }
    }
}
