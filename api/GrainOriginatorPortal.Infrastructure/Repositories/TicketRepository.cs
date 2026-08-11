using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class TicketRepository : ITicketRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<TicketRepository> _logger;

    public TicketRepository(OriginationDbContext context, ApplicationDbContext appContext, ILogger<TicketRepository> logger)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<List<Ticket>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

        // Two-path strategy. Both paths use STRING_SPLIT downstream to avoid SQL Server's
        // 2100-parameter IN-clause limit when the producer set is large.
        List<Ticket> tickets;

        if (!hasTradeUnitFilter)
        {
            // Unfiltered: every active producer in dbo.Customer. Trade unit selection is
            // a narrowing convenience, not an entitlement boundary.
            var customerCodes = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null)
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            if (customerCodes.Count == 0)
            {
                tickets = [];
            }
            else
            {
                // Same contract-scoped pattern as the filtered branch — applied tickets
                // follow their contract, not the ticket's CustomerCode. Without this, a
                // ticket whose CustomerCode is missing from dbo.Customer (inactive /
                // deleted / cross-system entity) would be dropped even when its contract
                // is otherwise visible.
                var openContractNumbers = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P"
                        && (c.ClosedDate == null || c.ClosedDate <= OdsConstants.OpenClosedDateSentinel)
                        && c.CtrmCustomerId != null && customerCodes.Contains(c.CtrmCustomerId)
                        && c.SourceContractId != null)
                    .Select(c => c.SourceContractId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                tickets = await LoadTicketsByContractAndCustomerScopeAsync(
                    openContractNumbers, customerCodes, cancellationToken);
            }
        }
        else
        {
            // Customer scope = producers in the selected TUs (via dbo.CustomerTradeUnit).
            var customerCodes = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null
                    && _appContext.CustomerTradeUnits.Any(ctu =>
                        ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits!.Contains(ctu.TradeUnit)))
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            // Open Purchase contracts whose customer is in the TU scope. We then load tickets
            // by their CtrmContractNumber matching this set — applied tickets follow the
            // contract, not the ticket's CustomerCode. CTRM data has split / cross-entity
            // tickets where ticket.CustomerCode != contract.CtrmCustomerId; filtering by
            // CustomerCode silently dropped those, so the contract under-reported deliveries.
            var openContractNumbers = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P"
                    && (c.ClosedDate == null || c.ClosedDate <= OdsConstants.OpenClosedDateSentinel)
                    && c.CtrmCustomerId != null && customerCodes.Contains(c.CtrmCustomerId)
                    && c.SourceContractId != null)
                .Select(c => c.SourceContractId!)
                .Distinct()
                .ToListAsync(cancellationToken);

            tickets = await LoadTicketsByContractAndCustomerScopeAsync(
                openContractNumbers, customerCodes, cancellationToken);
        }

        _logger.LogInformation("Loading tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
            hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

        // Load quality data in a single query using a server-side join on ticket IDs
        var ticketIds = tickets.Select(t => t.Id);
        var qualityData = await _context.TicketQualities
            .AsNoTracking()
            .Where(q => ticketIds.Contains(q.TicketId))
            .ToDictionaryAsync(q => q.TicketId, cancellationToken);

        // Populate moisture and quality data on tickets
        var ticketsWithProtein = 0;
        var wheatTickets = 0;
        foreach (var ticket in tickets)
        {
            if (qualityData.TryGetValue(ticket.Id, out var quality))
            {
                ticket.Moisture = quality.GradeFactorMoisturePercent;
                ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                ticket.ProteinPercent = quality.GradeFactorProteinPercent;

                if (ticket.ProteinPercent.HasValue)
                    ticketsWithProtein++;
            }

            if ((ticket.ProductCode ?? "").ToLower().Contains("wheat"))
                wheatTickets++;
        }

        _logger.LogInformation("Quality data: {TicketsWithProtein} tickets have protein data, {WheatTickets} wheat tickets found",
            ticketsWithProtein, wheatTickets);

        // Populate elevator city/state from ElevatorCache lookup
        await PopulateElevatorLocations(tickets, cancellationToken);

        // Log diagnostic info about ticket-contract relationships
        var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
        var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
        var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

        _logger.LogInformation("Loaded {TicketCount} tickets — {WithContractId} have ContractId, {WithContractNumber} have CtrmContractNumber, {WithBoth} have both",
            tickets.Count, ticketsWithContractId, ticketsWithContractNumber, ticketsWithBoth);

        return tickets;
    }

    public async Task<List<Ticket>> GetTodaysAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
    {
        var cutoffStr = DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-dd");
        var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

        List<Ticket> tickets;

        if (!hasTradeUnitFilter)
        {
            // Unfiltered: every active producer in dbo.Customer.
            var customerCodes = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null)
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            // Spot Loads only ever displays UNAPPLIED tickets (the UI skips applied ones), so we
            // run the fast CustomerCode-scoped branch only. The old applied/contract-number branch
            // scanned the 2M-row view (couldn't seek) and its rows were all discarded downstream —
            // dropping it is what turns this from minutes into <2s. Empty codes return [] inside.
            // includeStorageTickets: true so C-prefix (customer-storage) loads appear here too,
            // matching the customer page's Unapplied Tickets tab (gated to active storage). Adds
            // the ctrm.vw_GNTA39D1 storage lookup, but only for customers that actually have C tickets.
            tickets = await LoadUnappliedTicketsByCustomerScopeAsync(
                customerCodes, cancellationToken, cutoffStr, includeStorageTickets: true);
        }
        else
        {
            // Branch 1 (contract-number scope) is gone — Spot Loads discards applied tickets — but
            // the contract-derived CUSTOMER codes still widen which producers' unapplied loads
            // appear (a producer can have a P-contract tagged to a TU without an active
            // CustomerTradeUnit snapshot row), so we keep deriving them to preserve identical
            // producer scope. Only SourceContractId (which fed Branch 1) is dropped.
            var contractCustomerCodes = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                    && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                .Select(c => c.CtrmCustomerId!)
                .Distinct()
                .ToListAsync(cancellationToken);

            var snapshotCustomerCodes = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null
                    && _appContext.CustomerTradeUnits.Any(ctu =>
                        ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits!.Contains(ctu.TradeUnit)))
                .Select(c => c.ScoularId!)
                .ToListAsync(cancellationToken);

            var customerCodes = contractCustomerCodes.Union(snapshotCustomerCodes).ToList();

            // includeStorageTickets: true — see the no-filter branch above. C-prefix storage loads
            // are surfaced in Spot Loads (gated to active storage) for parity with the customer page.
            tickets = await LoadUnappliedTicketsByCustomerScopeAsync(
                customerCodes, cancellationToken, cutoffStr, includeStorageTickets: true);
        }

        _logger.LogInformation("Loaded {TicketCount} recent tickets for spot loads (filtered: {IsFiltered}, cutoff: {CutoffStr})",
            tickets.Count, hasTradeUnitFilter, cutoffStr);

        // Intentionally NO quality (moisture/protein/test-weight) or elevator city/state enrichment
        // here: appState.todaysTickets is consumed only by Actionable Insights → Spot Loads, which
        // displays none of those fields. Skipping them drops 1-3 extra round-trips (the
        // TicketQualities IN-clause + the ctrm.vw_GNP026 / vw_GNP003 elevator lookups) off this
        // UI-blocking call. The full /api/tickets path (GetAsync) still enriches.
        return tickets;
    }

    public async Task<List<Ticket>> GetByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
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

        // Build the customer's open Purchase contract number set. We match tickets to
        // contracts via the string SourceContractId ↔ ContractNumber pairing because the
        // bigint Ticket.ContractId FK isn't reliably populated in vw_CurrentTickets (split
        // tickets / older records can have null). The string contract number is the
        // authoritative join key in the ODS shape. CtrmCustomerId is the customer-level
        // filter on contracts; tickets may carry a different CustomerCode than the
        // contract's CtrmCustomerId (CTRM splits across related entities), which is why
        // the unapplied branch below still scopes by CustomerCode.
        var openContractNumbers = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && c.ContractPrefixType == "P"
                && (c.ClosedDate == null || c.ClosedDate <= OdsConstants.OpenClosedDateSentinel)
                && c.CtrmCustomerId == scoularId
                && c.SourceContractId != null)
            .Select(c => c.SourceContractId!)
            .Distinct()
            .ToListAsync(cancellationToken);

        _context.Database.SetCommandTimeout(120);

        // 3-year cutoff bounds the scan against the 2M-row ticket view. Open contracts almost
        // always have delivery windows under a year, so 3 years is generous for applied tickets;
        // unapplied tickets older than 3 years aren't actionable. TicketBlDate is stored as a
        // string in the ODS, so the cutoff is an ISO yyyy-MM-dd literal which compares
        // lexicographically (safe for that format).
        var cutoff = DateTime.UtcNow.AddYears(-3).ToString("yyyy-MM-dd");

        // Single LINQ query with applied ∪ unapplied as an OR. Applied side matches
        // Ticket.ContractNumber against the customer's open Purchase contract numbers —
        // for a per-customer scope the IN list is small (a handful of contracts) so EF
        // emits an explicit IN clause the optimizer seeks on. The unapplied side is
        // anchored on the single CustomerCode plus a sargable StartsWith on
        // ContractNumber (translated to LIKE 'X%'). The two branches are mutually
        // exclusive (P-prefix vs U/L/C-prefix), so the OR doesn't double-count.
        var tickets = await _context.Tickets
            .AsNoTracking()
            .Where(t => (t.TicketType == "U" || t.TicketType == "P")
                && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                && t.Date != null
                && string.Compare(t.Date, cutoff) >= 0
                && t.CtrmContractNumber != null
                && (
                    openContractNumbers.Contains(t.CtrmContractNumber)
                    ||
                    (t.CustomerCode == scoularId
                     && (t.CtrmContractNumber.StartsWith("U")
                         || t.CtrmContractNumber.StartsWith("L")
                         || t.CtrmContractNumber.StartsWith("C")))
                ))
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Customer-storage (C-prefix) tickets linger after the grain is priced out; keep one only
        // if the producer still holds that commodity in active storage. Gate before enrichment so
        // we don't hydrate quality/elevator for tickets we're about to drop. Mirrors
        // GetUnappliedByCustomerAsync so the customer page's Unapplied tab shows the same
        // storage-gated set regardless of which fetch populated it.
        if (tickets.Exists(t => t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)))
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(new[] { scoularId }, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        // Load quality data for these tickets
        var ticketIds = tickets.Select(t => t.Id).ToList();
        var qualityList = await _context.TicketQualities
            .AsNoTracking()
            .Where(q => ticketIds.Contains(q.TicketId))
            .ToListAsync(cancellationToken);

        var qualityData = qualityList.ToDictionary(q => q.TicketId);

        // Populate moisture and quality data on tickets
        foreach (var ticket in tickets)
        {
            if (qualityData.TryGetValue(ticket.Id, out var quality))
            {
                ticket.Moisture = quality.GradeFactorMoisturePercent;
                ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                ticket.ProteinPercent = quality.GradeFactorProteinPercent;
            }
        }

        await PopulateElevatorLocations(tickets, cancellationToken);

        _logger.LogInformation("Found {TicketCount} tickets for customer {CustomerId} (ScoularId: {ScoularId})",
            tickets.Count, customerId, scoularId);
        return tickets;
    }

    public async Task<List<Ticket>> GetUnappliedByCustomerAsync(long customerId, string? scoularId, CancellationToken cancellationToken)
    {
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

        _context.Database.SetCommandTimeout(120);

        // 3-year cutoff — old unapplied tickets aren't actionable.
        var cutoff = DateTime.UtcNow.AddYears(-3).ToString("yyyy-MM-dd");

        var tickets = await _context.Tickets
            .AsNoTracking()
            .Where(t => (t.TicketType == "U" || t.TicketType == "P")
                && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                && t.CustomerCode == scoularId
                && t.CtrmContractNumber != null
                && (t.CtrmContractNumber.StartsWith("U")
                    || t.CtrmContractNumber.StartsWith("L")
                    || t.CtrmContractNumber.StartsWith("C"))
                && t.Date != null
                && string.Compare(t.Date, cutoff) >= 0)
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Customer-storage (C-prefix) tickets linger after the grain is priced out; keep one
        // only if the producer still holds that commodity in active storage. Filter before
        // enrichment so we don't hydrate quality/elevator for tickets we're about to drop.
        if (tickets.Exists(t => t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)))
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(new[] { scoularId }, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        await PopulateQualityAndElevatorAsync(tickets, cancellationToken);

        _logger.LogInformation("Found {TicketCount} unapplied tickets for customer {CustomerId} (ScoularId: {ScoularId})",
            tickets.Count, customerId, scoularId);
        return tickets;
    }

    public async Task<List<Ticket>> GetAppliedByContractAsync(string sourceContractId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId)) return [];
        var trimmed = sourceContractId.Trim();

        _context.Database.SetCommandTimeout(120);

        var tickets = await _context.Tickets
            .AsNoTracking()
            .Where(t => (t.TicketType == "U" || t.TicketType == "P")
                && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                && t.CtrmContractNumber == trimmed)
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        await PopulateQualityAndElevatorAsync(tickets, cancellationToken);

        _logger.LogInformation("Found {TicketCount} applied tickets for contract {ContractNumber}",
            tickets.Count, trimmed);
        return tickets;
    }

    public Task<List<Ticket>> GetByFarmAsync(string farmId, CancellationToken cancellationToken)
    {
        // Note: FarmId is not in ODS tickets view - cannot filter by farm
        _logger.LogWarning("Ticket.FarmId is not mapped in ODS - returning empty list for farm {FarmId}", farmId);
        return Task.FromResult(new List<Ticket>());
    }

    private async Task<List<Ticket>> LoadTicketsByContractAndCustomerScopeAsync(
        List<string> openContractNumbers,
        List<string> customerCodes,
        CancellationToken cancellationToken,
        string? cutoffDateInclusive = null,
        bool includeStorageTickets = true)
    {
        if (openContractNumbers.Count == 0 && customerCodes.Count == 0) return new List<Ticket>();

        // vw_CurrentTickets is a heavy view (~2M rows). The view's plan against ContractNumber
        // can't seek (no usable index for our access pattern), so the bulk TU-wide scan can run
        // 2-3+ minutes. A 120s cap was getting clipped (~125s) and returning [] which made the
        // UI render "(0)" applied tickets forever. 300s is the practical ceiling — the bulk runs
        // off the request path (background after TU select) and per-customer scopes still return
        // in <2s when CustomerCode seeks cleanly. A local synced ticket table is the durable fix.
        _context.Database.SetCommandTimeout(300);

        // STRING_SPLIT can't take an empty CSV in this app's existing pattern; pass a sentinel
        // that won't match anything when one list is empty so the OR branch becomes a no-op.
        // Contract numbers can legitimately contain spaces (e.g. "PW 452117"), so use the
        // identifier-safe sanitizer for that list; customer codes use the stricter one.
        var contractsCsv = openContractNumbers.Count > 0 ? SanitizeIdentifierCsv(openContractNumbers) : "__none__";
        var codesCsv = customerCodes.Count > 0 ? SanitizeCsv(customerCodes) : "__none__";

        // The TicketBlDate column on vw_CurrentTickets is stored as a string; an inclusive
        // ISO yyyy-MM-dd cutoff lets the SpotLoads / today's-tickets path narrow the result
        // set at the SQL layer. Null cutoff = no date filter (used by the broad contracts page paths).
        // (C# property Ticket.Date maps to DB column TicketBlDate; raw SQL has to use the column name.)
        var cutoff = cutoffDateInclusive ?? string.Empty;

        // 1 = include C-prefix (customer-storage) unapplied tickets; 0 = U/L only. When 0 the storage
        // gate below is also skipped, so this whole call stays off the slow ctrm.vw_GNTA39D1 scan.
        var storageFlag = includeStorageTickets ? 1 : 0;

        // Two indexed lookups UNION ALL'd (the two branches are mutually exclusive — applied
        // tickets carry a P-prefix contract number, unapplied carry U/L/C — so SQL Server's
        // UNION dedup step is wasted work on a multi-million-row view). Each branch is an
        // INNER JOIN to STRING_SPLIT on an indexed column (ContractNumber / CustomerCode), so
        // the optimizer picks index seeks instead of scans. The cutoff is parameterized once
        // and applied symmetrically.
        //
        // Column list is explicit (not SELECT *) — names every column the EF Ticket entity maps,
        // matching OriginationDbContext.OnModelCreating for Ticket. Saves the view's row-width
        // bloat from columns we don't read. Adding a new mapped column to Ticket REQUIRES adding
        // it here too — EF materialization will fail if a mapped column is missing from the result.
        //
        // The unapplied prefix predicate uses three sargable LIKE 'X%' tests (not LEFT(col,1) IN ...)
        // so the optimizer can index-seek the prefix range on ContractNumber. The LEFT() form was
        // non-sargable and forced a scan of every row reached by the CustomerCode seek.
        //
        // Excludes BSTATS='CSL' (Consolidated) tickets — those have already been merged INTO
        // another ticket and showing them double-counts the bushels. PRG (Purged) doesn't reach
        // this view at all, so no filter needed. NULL-status rows kept defensively.
        var tickets = await _context.Tickets
            .FromSqlInterpolated($@"
                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({contractsCsv}, ',') x ON t.ContractNumber = x.value
                WHERE t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))

                UNION ALL

                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({codesCsv}, ',') c ON t.CustomerCode = c.value
                WHERE t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND t.ContractNumber IS NOT NULL
                  AND (t.ContractNumber LIKE 'U%' OR t.ContractNumber LIKE 'L%'
                       OR ({storageFlag} = 1 AND t.ContractNumber LIKE 'C%'))
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))")
            .AsNoTracking()
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Gate customer-storage (C-prefix) tickets: keep one only while the producer still holds
        // that commodity in active storage. Priced-out storage leaves orphan unload tickets in
        // vw_CurrentTickets that would otherwise show as unapplied forever. Only the C-prefix
        // tickets (which come from the CustomerCode branch above) are affected; applied (P) and
        // U/L tickets pass through. Looked up only for the customers that actually have C tickets,
        // so producers with no storage cost nothing. Skipped entirely when storage is excluded
        // (no C tickets to gate, and avoids the slow ctrm.vw_GNTA39D1 lookup).
        if (!includeStorageTickets) return tickets;

        var storageCustomerCodes = tickets
            .Where(t => t.CtrmContractNumber is { Length: > 0 } cn
                && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(t.CustomerCode))
            .Select(t => t.CustomerCode!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (storageCustomerCodes.Count > 0)
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(storageCustomerCodes, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        return tickets;
    }

    /// <summary>
    /// Loads ONLY unapplied (U/L, optionally C-storage) tickets scoped by CustomerCode — the fast,
    /// index-seekable branch of <see cref="LoadTicketsByContractAndCustomerScopeAsync"/> with the
    /// 2M-row ContractNumber-scan branch omitted ENTIRELY (not just fed an empty list — that join
    /// can't seek even for a no-match value, so it would still scan). Spot Loads / today's-tickets
    /// is the only caller: the UI discards every applied ticket, so the contract-scoped branch was
    /// pure waste there and was what made the dropdown spin for minutes.
    /// <para>STRING_SPLIT keeps a large producer set under the 2100-parameter IN-clause limit.
    /// C-prefix (customer-storage) tickets are gated against active storage only when
    /// <paramref name="includeStorageTickets"/> is true; today's path passes false and skips the gate.</para>
    /// </summary>
    private async Task<List<Ticket>> LoadUnappliedTicketsByCustomerScopeAsync(
        List<string> customerCodes,
        CancellationToken cancellationToken,
        string? cutoffDateInclusive = null,
        bool includeStorageTickets = true)
    {
        if (customerCodes.Count == 0) return new List<Ticket>();

        // CustomerCode seeks cleanly on vw_CurrentTickets, so this returns in <2s even TU-wide.
        // (The slow path was the omitted ContractNumber-scan branch.) 120s is a generous cold-cache cap.
        _context.Database.SetCommandTimeout(120);

        // codesCsv is never empty here (guarded above), so no "__none__" sentinel is needed.
        var codesCsv = SanitizeCsv(customerCodes);
        var cutoff = cutoffDateInclusive ?? string.Empty;
        var storageFlag = includeStorageTickets ? 1 : 0;

        // Branch 2 of LoadTicketsByContractAndCustomerScopeAsync, standalone. The column list MUST
        // stay in sync with the EF Ticket mapping (OriginationDbContext.OnModelCreating) — EF
        // materialization fails if a mapped column is missing from the result.
        var tickets = await _context.Tickets
            .FromSqlInterpolated($@"
                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({codesCsv}, ',') c ON t.CustomerCode = c.value
                WHERE t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND t.ContractNumber IS NOT NULL
                  AND (t.ContractNumber LIKE 'U%' OR t.ContractNumber LIKE 'L%'
                       OR ({storageFlag} = 1 AND t.ContractNumber LIKE 'C%'))
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))")
            .AsNoTracking()
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Today's path passes includeStorageTickets: false, so it returns here and never touches
        // the slow ctrm.vw_GNTA39D1 storage scan. Storage gating mirrors the shared method exactly.
        if (!includeStorageTickets) return tickets;

        var storageCustomerCodes = tickets
            .Where(t => t.CtrmContractNumber is { Length: > 0 } cn
                && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(t.CustomerCode))
            .Select(t => t.CustomerCode!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (storageCustomerCodes.Count > 0)
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(storageCustomerCodes, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        return tickets;
    }

    // Resolves each ticket's display location from dbo.MbpLocationSynonym (the MBPLOCSYN master):
    // LocationId = "{OrganizationCode}-{ElevatorCode}" -> DisplayName (e.g. 1075 + MADRID => "Madrid, NE").
    // ONLY tickets carrying BOTH an organization code AND an elevator code are matched; a ticket with no
    // elevator code, or with no matching row, is left blank. This fully replaces the former
    // vw_GNP026 / vw_GNP003 elevator lookup. DisplayName is already the full "City, ST" string the UI
    // shows, so it goes in ElevatorCity (ElevatorState left null) and renders verbatim on the unapplied /
    // applied / storage ticket views with no client change.
    private async Task PopulateElevatorLocations(List<Ticket> tickets, CancellationToken cancellationToken)
    {
        // Only org+elevator tickets resolve; their key is "{Org}-{Elevator}", matched to LocationId.
        var keyed = tickets
            .Where(t => !string.IsNullOrWhiteSpace(t.OrganizationCode) && !string.IsNullOrWhiteSpace(t.ElevatorCode))
            .ToList();
        if (keyed.Count == 0) return;

        var locationIds = keyed
            .Select(t => $"{t.OrganizationCode!.Trim()}-{t.ElevatorCode!.Trim()}")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        try
        {
            var rows = await _appContext.MbpLocationSynonyms
                .AsNoTracking()
                .Where(m => locationIds.Contains(m.LocationId) && m.DisplayName != null)
                .Select(m => new { m.LocationId, m.DisplayName })
                .ToListAsync(cancellationToken);

            var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows)
                if (!string.IsNullOrWhiteSpace(r.DisplayName))
                    lookup[r.LocationId.Trim()] = r.DisplayName!.Trim();

            foreach (var ticket in keyed)
            {
                var key = $"{ticket.OrganizationCode!.Trim()}-{ticket.ElevatorCode!.Trim()}";
                if (lookup.TryGetValue(key, out var display))
                {
                    // DisplayName is the full "City, ST" text → ElevatorCity (state left null) so the
                    // existing UI shows it verbatim. Unmatched tickets stay blank.
                    ticket.ElevatorCity = display;
                    ticket.ElevatorState = null;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "MbpLocationSynonym location lookup failed — tickets will load without location display");
        }
    }

    /// <summary>
    /// Commodity codes each customer currently holds in active customer storage (ctrm.vw_GNTA39D1,
    /// latest snapshot, net qty &gt; 0), keyed by Scoular customer code. Used to gate C-prefix
    /// (customer-storage) unapplied tickets: a storage unload ticket stays in vw_CurrentTickets
    /// after the grain is priced out, so it only counts as unapplied while the producer still has
    /// that commodity on hand here. Mirrors the STATUS / latest-run-stamp shape of the Storage tab
    /// so the two screens agree on what's "in storage".
    /// </summary>
    public async Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        if (customerCodes.Count == 0) return result;

        var codesCsv = SanitizeCsv(customerCodes);

        // GROUP BY customer+commodity at the latest snapshot; HAVING net > 0 means the producer
        // still physically holds that commodity. Join on raw CUSTOMER_ID (T-SQL '=' ignores the
        // view's trailing spaces); SELECT/GROUP BY trim+upper for a clean dictionary key.
        const string sql = """
            SELECT UPPER(LTRIM(RTRIM(s.CUSTOMER_ID)))    AS CustomerCode,
                   UPPER(LTRIM(RTRIM(s.COMMODITY_CODE)))  AS Commodity
            FROM ctrm.vw_GNTA39D1 s
            INNER JOIN STRING_SPLIT(@codesCsv, ',') c ON s.CUSTOMER_ID = c.value
            WHERE s.STATUS IN ('S','F','D')
              AND s.REPORT_RUN_STAMP = (SELECT MAX(REPORT_RUN_STAMP) FROM ctrm.vw_GNTA39D1)
            GROUP BY UPPER(LTRIM(RTRIM(s.CUSTOMER_ID))), UPPER(LTRIM(RTRIM(s.COMMODITY_CODE)))
            HAVING SUM(ISNULL(s.NET_QUANTITY, 0)) > 0
            """;

        var rows = await _context.Database
            .SqlQueryRaw<StorageCommodity>(sql, new SqlParameter("@codesCsv", codesCsv))
            .ToListAsync(cancellationToken);

        foreach (var row in rows)
        {
            if (string.IsNullOrEmpty(row.CustomerCode) || string.IsNullOrEmpty(row.Commodity)) continue;
            if (!result.TryGetValue(row.CustomerCode, out var set))
            {
                set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[row.CustomerCode] = set;
            }
            set.Add(row.Commodity);
        }
        return result;
    }

    /// <summary>
    /// Drops customer-storage (C-prefix) tickets whose grain is no longer in storage. A C-prefix
    /// unload ticket lingers in vw_CurrentTickets after the producer prices the grain out; it's
    /// only genuinely unapplied while that commodity still shows in <paramref name="storageByCustomer"/>.
    /// U / L tickets and everything else pass through untouched. Match is commodity-level (the
    /// ticket carries no storage-receipt id), so a producer who priced out one batch but still
    /// stores another batch of the same commodity keeps the older tickets — a rare, accepted edge.
    /// </summary>
    public List<Ticket> GateCustomerStorageTickets(
        List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
    {
        return tickets.Where(t =>
        {
            var contractNumber = t.CtrmContractNumber;
            if (contractNumber is not { Length: > 0 } || !contractNumber.StartsWith("C", StringComparison.OrdinalIgnoreCase))
                return true; // not customer-storage — unaffected

            if (string.IsNullOrEmpty(t.CustomerCode) || string.IsNullOrEmpty(t.ProductCode))
                return false; // storage ticket we can't match to a producer/commodity — treat as priced out

            return storageByCustomer.TryGetValue(t.CustomerCode.Trim(), out var commodities)
                && commodities.Contains(t.ProductCode.Trim());
        }).ToList();
    }

    /// <summary>Hydrates quality (moisture/protein/test weight) and elevator city/state onto a
    /// loaded ticket set. Shared by the per-producer unapplied and per-contract applied fetches
    /// so post-load enrichment stays consistent.</summary>
    private async Task PopulateQualityAndElevatorAsync(List<Ticket> tickets, CancellationToken cancellationToken)
    {
        if (tickets.Count == 0) return;

        var ticketIds = tickets.Select(t => t.Id).ToList();
        var qualityList = await _context.TicketQualities
            .AsNoTracking()
            .Where(q => ticketIds.Contains(q.TicketId))
            .ToListAsync(cancellationToken);
        var qualityData = qualityList.ToDictionary(q => q.TicketId);
        foreach (var ticket in tickets)
        {
            if (qualityData.TryGetValue(ticket.Id, out var quality))
            {
                ticket.Moisture = quality.GradeFactorMoisturePercent;
                ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                ticket.ProteinPercent = quality.GradeFactorProteinPercent;
            }
        }

        await PopulateElevatorLocations(tickets, cancellationToken);
    }
}
