using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// SQL Server implementation of IDataService using Entity Framework Core.
/// Provides data access to Azure SQL Database with managed identity authentication.
/// </summary>
public class SqlDataService : IDataService
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<SqlDataService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public SqlDataService(OriginationDbContext context, ApplicationDbContext appContext, ILogger<SqlDataService> logger, IHttpContextAccessor httpContextAccessor)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
    }

    private string GetTraceId() =>
        _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
        ?? _httpContextAccessor.HttpContext?.TraceIdentifier
        ?? "no-trace";

    private string GetCurrentUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        return user?.FindFirst("name")?.Value
            ?? user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name
            ?? "System";
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public async Task<List<Customer>> GetCustomersAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;
            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units: {string.Join(", ", tradeUnits)})" : "";

            var query = _appContext.CustomerSnapshots.AsNoTracking().Where(s => s.IsActive);
            if (hasTradeUnitFilter)
                query = query.Where(s => s.TradeUnit != null && tradeUnits!.Contains(s.TradeUnit));

            var snapshots = await query.OrderBy(s => s.CustomerName).ToListAsync(cancellationToken);

            // Deduplicate: one Customer per CustomerId (snapshot has one row per customer per trade unit)
            var customers = snapshots
                .GroupBy(s => s.CustomerId)
                .Select(g => MapSnapshotToCustomer(g.First()))
                .OrderBy(c => c.Name)
                .ToList();

            await EnrichCustomersWithESignAsync(customers, cancellationToken);
            _logger.LogInformation("Returning {Count} customers from CustomerSnapshot{Filter}", customers.Count, filterMsg);
            return customers;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "CustomerSnapshot table/column not found (SQL {Number}) — returning empty customer list [{TraceId}]",
                ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving customers — returning empty customer list [{TraceId}]",
                GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Customer>> SearchCustomersAsync(string searchTerm, List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();

            var query = _appContext.CustomerSnapshots.AsNoTracking().Where(s => s.IsActive).AsQueryable();

            if (hasTradeUnitFilter)
                query = query.Where(s => s.TradeUnit != null && tradeUnits!.Contains(s.TradeUnit));

            // All search words must match name, source customer ID, or phone number
            foreach (var word in searchWords)
                query = query.Where(s => s.CustomerName.Contains(word)
                    || (s.SourceCustomerId != null && s.SourceCustomerId.Contains(word))
                    || (s.MerchandisingPhone != null && s.MerchandisingPhone.Contains(word))
                    || (s.ExtendedPrimaryPhone != null && s.ExtendedPrimaryPhone.Contains(word)));

            var snapshots = await query.Take(1000).ToListAsync(cancellationToken);

            // Deduplicate by CustomerId, then score by relevance
            var candidates = snapshots
                .GroupBy(s => s.CustomerId)
                .Select(g => MapSnapshotToCustomer(g.First()))
                .ToList();

            var scoredCustomers = candidates.Select(c => new
            {
                Customer = c,
                Score = CalculateRelevanceScore(c.Name, searchWords, searchTerm)
            })
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.Customer.Name)
            .Select(x => x.Customer)
            .ToList();

            await EnrichCustomersWithESignAsync(scoredCustomers, cancellationToken);
            _logger.LogInformation("Search for '{SearchTerm}' returned {Count} customers from CustomerSnapshot", searchTerm, scoredCustomers.Count);
            return scoredCustomers;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "CustomerSnapshot table/column not found (SQL {Number}) — returning empty search results [{TraceId}]",
                ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error searching customers — returning empty search results [{TraceId}]",
                GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching customers for term: {SearchTerm} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                searchTerm, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Maps a CustomerSnapshot row to the Customer model used by the API.
    /// CustomerSnapshot stores one row per customer-trade unit pair; callers must deduplicate.
    /// </summary>
    private static Customer MapSnapshotToCustomer(CustomerSnapshot snap) => new()
    {
        Id = snap.CustomerId,
        Name = snap.CustomerName,
        SourceCustomerId = snap.SourceCustomerId,
        IndustryCode1 = snap.IndustryCode1,
        IsActive = snap.IsActive,
        EffectiveStartDate = snap.EffectiveStartDate,
        EffectiveEndDate = snap.EffectiveEndDate,
        Phone = snap.MerchandisingPhone,
        Email = snap.MerchandisingEmail,
        ExtendedPrimaryPhone = snap.ExtendedPrimaryPhone,
        SupplementalEmail = snap.SupplementalEmail,
        Location = snap.MerchandisingCity,
        StateProvince = snap.MerchandisingStateProvince,
        AddressLine1 = snap.MerchandisingAddressLine1,
        PostalCode = snap.MerchandisingPostalCode,
        ExtendedAddressLine1 = snap.ExtendedAddressLine1,
        ExtendedAddressLine2 = snap.ExtendedAddressLine2,
        ExtendedAddressLine3 = snap.ExtendedAddressLine3,
        ExtendedAddressLine4 = snap.ExtendedAddressLine4,
        ExtendedCity = snap.ExtendedCity,
        ExtendedPostalCode = snap.ExtendedPostalCode,
        ExtendedStateProvince = snap.ExtendedStateProvince,
        ExtendedCountry = snap.ExtendedCountry,
    };

    /// <summary>
    /// Looks up eSign enrollment records for the given customers and populates
    /// ESignEnabled and ScoularViewRecipients from dbo.eSignEnrollment.
    /// </summary>
    private async Task EnrichCustomersWithESignAsync(List<Customer> customers, CancellationToken cancellationToken = default)
    {
        if (customers.Count == 0) return;

        var codes = customers
            .Where(c => c.SourceCustomerId != null)
            .Select(c => c.SourceCustomerId!)
            .Distinct()
            .ToList();

        // Presence in table = enrolled (table only contains eSign customers).
        var enrollmentList = await _appContext.ESignEnrollments
            .AsNoTracking()
            .Where(e => codes.Contains(e.CustomerCode))
            .ToListAsync(cancellationToken);

        // For duplicates: find the first row with real ScoularViewRecipients
        // (not null, empty, or "No"). If none have recipients, value stays null.
        var enrollments = enrollmentList
            .GroupBy(e => e.CustomerCode)
            .ToDictionary(
                g => g.Key,
                g => g.FirstOrDefault(e =>
                    !string.IsNullOrWhiteSpace(e.ScoularViewRecipients) &&
                    !e.ScoularViewRecipients!.Equals("No", StringComparison.OrdinalIgnoreCase)
                )?.ScoularViewRecipients);

        foreach (var customer in customers)
        {
            if (customer.SourceCustomerId != null &&
                enrollments.TryGetValue(customer.SourceCustomerId, out var recipients))
            {
                customer.ESignEnabled = true;
                customer.ScoularViewRecipients = recipients;
            }
        }
    }

    /// <summary>
    /// Calculates a relevance score for a customer name based on how well it matches the search terms.
    /// Higher scores indicate better matches.
    /// </summary>
    private int CalculateRelevanceScore(string customerName, List<string> searchWords, string originalSearchTerm)
    {
        var score = 0;
        var nameUpper = customerName.ToUpper();
        var searchTermUpper = originalSearchTerm.ToUpper();

        // Boost 1: Exact match (very rare but highest priority)
        if (nameUpper == searchTermUpper)
        {
            score += 10000;
            return score; // Perfect match, no need for other checks
        }

        // Boost 2: Name starts with search term (e.g., "JIM" matches "JIM JOHNSON")
        if (nameUpper.StartsWith(searchTermUpper))
        {
            score += 5000;
        }

        // Boost 3: Search term appears as contiguous substring (e.g., "Jim Johnson" in "Johnson, Jim R")
        if (nameUpper.Contains(searchTermUpper.Replace(",", "").Replace("  ", " ")))
        {
            score += 3000;
        }

        // Boost 4: All search words appear in the same order they were typed
        var lastIndex = -1;
        var inOrder = true;
        foreach (var word in searchWords)
        {
            var index = nameUpper.IndexOf(word.ToUpper(), lastIndex + 1);
            if (index <= lastIndex)
            {
                inOrder = false;
                break;
            }
            lastIndex = index;
        }
        if (inOrder)
        {
            score += 2000;
        }

        // Boost 5: Fewer total words in name (more specific matches rank higher)
        // "Johnson, Jim R" (3 words) should rank higher than "JIM JOHNSON - PROJECT 17" (5 words)
        var nameWords = customerName.Split(new[] { ' ', ',', '-' }, StringSplitOptions.RemoveEmptyEntries).Length;
        score += Math.Max(0, 100 - (nameWords * 10)); // Penalize longer names

        // Boost 6: Each search word that appears early in the name
        foreach (var word in searchWords)
        {
            var index = nameUpper.IndexOf(word.ToUpper());
            if (index >= 0)
            {
                // Earlier positions get higher scores (max 100 for position 0, decreasing)
                score += Math.Max(0, 100 - index);
            }
        }

        // Boost 7: Proportion of search words to total name words (coverage)
        // If search has 3 words and name has 3 words, that's 100% coverage (better than 3 words in a 5-word name)
        var coverage = (double)searchWords.Count / nameWords;
        score += (int)(coverage * 500);

        return score;
    }

    public async Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && c.IsActive, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                id, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Customer?> GetCustomerBySourceIdAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.SourceCustomerId == sourceCustomerId && c.IsActive, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer by source ID {SourceCustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceCustomerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task UpdateCustomerAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken = default)
    {
        try
        {
            var customer = await _context.Customers.FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
            if (customer == null)
            {
                _logger.LogWarning("Customer {CustomerId} not found for update", customerId);
                return;
            }

            customer.Location = location;
            customer.Phone = phone;
            customer.Email = email;
            customer.FarmIds = farmIds;
            customer.LinkedProducerIds = linkedProducerIds;

            // Recalculate TotalAcres based on associated farms
            // Note: Farms table doesn't exist in ODS - skipping TotalAcres calculation
            // customer.TotalAcres = _context.Farms
            //     .Where(f => farmIds.Contains(f.Id))
            //     .Sum(f => f.Acres);
            customer.TotalAcres = 0;

            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Updated customer {CustomerId}", customerId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public async Task<List<string>> GetTradeUnitsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var cachedTradeUnits = await _appContext.TradeUnits
                .Where(tu => tu.IsActive)
                .Select(tu => tu.Code)
                .OrderBy(c => c)
                .ToListAsync(cancellationToken);

            if (cachedTradeUnits.Count > 0)
            {
                _logger.LogInformation("Returning {Count} trade units from dbo.TradeUnits", cachedTradeUnits.Count);
                return cachedTradeUnits;
            }

            // Table is empty - one-time population from ODS
            _logger.LogInformation("dbo.TradeUnits is empty - performing one-time population from ODS");
            var tradeUnitsFromOds = await GetTradeUnitsFromViewsAsync(cancellationToken);

            foreach (var code in tradeUnitsFromOds)
            {
                _appContext.TradeUnits.Add(new TradeUnit { Code = code, IsActive = true });
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            return tradeUnitsFromOds;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade units [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    private async Task<List<string>> GetTradeUnitsFromViewsAsync(CancellationToken cancellationToken = default)
    {
        // Get unique trade units from contracts
        var contractTradeUnits = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && !string.IsNullOrEmpty(c.TradeUnit))
            .Select(c => c.TradeUnit!)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Get unique organization codes from tickets
        var ticketOrgCodes = await _context.Tickets
            .AsNoTracking()
            .Where(t => t.IsActive && !string.IsNullOrEmpty(t.OrganizationCode))
            .Select(t => t.OrganizationCode!)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Combine and return unique sorted list
        var allTradeUnits = contractTradeUnits
            .Union(ticketOrgCodes)
            .OrderBy(tu => tu)
            .ToList();

        return allTradeUnits;
    }

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    public async Task<List<Commodity>> GetCommoditiesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            // Fast read-only query — sync runs at startup via SyncCommoditiesAsync
            return await _appContext.Commodities
                .AsNoTracking()
                .Where(c => c.IsActive)
                .OrderBy(c => c.Name)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Syncs the Commodities table from ODS contract/ticket data.
    /// Called once at app startup — not on every API request.
    /// </summary>
    public async Task SyncCommoditiesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var existingCodesList = await _appContext.Commodities
                .Where(c => c.IsActive)
                .Select(c => c.Code)
                .ToListAsync(cancellationToken);

            var existingCodes = new HashSet<string>(existingCodesList, StringComparer.OrdinalIgnoreCase);

            // Pull all commodity data from contracts (Code, Name, Category)
            var contractCommodities = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive
                    && !string.IsNullOrEmpty(c.CommodityCode)
                    && !string.IsNullOrEmpty(c.CommodityDescription))
                .Select(c => new { c.CommodityCode, c.CommodityDescription, c.CommodityGroup })
                .Distinct()
                .ToListAsync(cancellationToken);

            // Pull all distinct product codes from tickets
            var ticketProductCodes = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && !string.IsNullOrEmpty(t.ProductCode))
                .Select(t => t.ProductCode!)
                .Distinct()
                .ToListAsync(cancellationToken);

            // Build lookup from contracts for description and category
            var contractLookup = contractCommodities
                .GroupBy(c => c.CommodityCode!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            bool changed = false;

            // Add any contract commodities not yet in the table
            foreach (var item in contractCommodities)
            {
                if (!existingCodes.Contains(item.CommodityCode!))
                {
                    _appContext.Commodities.Add(new Commodity
                    {
                        Code = item.CommodityCode!,
                        Name = item.CommodityDescription!,
                        Category = item.CommodityGroup,
                        IsActive = true
                    });
                    existingCodes.Add(item.CommodityCode!);
                    changed = true;
                }
            }

            // Add any ticket product codes not already covered by contracts
            foreach (var productCode in ticketProductCodes)
            {
                if (!existingCodes.Contains(productCode))
                {
                    contractLookup.TryGetValue(productCode, out var match);
                    _appContext.Commodities.Add(new Commodity
                    {
                        Code = productCode,
                        Name = match?.CommodityDescription ?? productCode,
                        Category = match?.CommodityGroup,
                        IsActive = true
                    });
                    existingCodes.Add(productCode);
                    changed = true;
                }
            }

            // Backfill Category for any commodities missing it
            var allCommodities = await _appContext.Commodities.Where(c => c.IsActive).ToListAsync(cancellationToken);
            foreach (var commodity in allCommodities.Where(c => string.IsNullOrEmpty(c.Category)))
            {
                if (contractLookup.TryGetValue(commodity.Code, out var match)
                    && !string.IsNullOrEmpty(match.CommodityGroup))
                {
                    commodity.Category = match.CommodityGroup;
                    changed = true;
                }
            }

            if (changed)
            {
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Synced commodities from ODS - now {Count} total", allCommodities.Count);
            }
            else
            {
                _logger.LogInformation("Commodity sync complete - no changes ({Count} total)", allCommodities.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            // Don't throw — sync failure shouldn't prevent app startup
        }
    }

    public async Task<List<TradeUnitGroup>> GetTradeUnitGroupsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var groups = await _appContext.TradeUnitGroups
                .AsNoTracking()
                .Where(g => g.IsActive)
                .Include(g => g.TradeUnits.Where(tu => tu.IsActive))
                .OrderBy(g => g.GroupName)
                .ToListAsync(cancellationToken);

            _logger.LogInformation("Returning {Count} trade unit groups", groups.Count);
            return groups;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade unit groups [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Farm Operations - DISABLED: Farms table doesn't exist in ODS
    // =========================================================================

    public Task<List<Farm>> GetFarmsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<Farm>());
    }

    public Task<List<Farm>> GetFarmsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return Task.FromResult(new List<Farm>());
    }

    public Task<Farm?> GetFarmByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning null for farm {FarmId}", id);
        return Task.FromResult<Farm?>(null);
    }

    public Task<string> CreateFarmAsync(string name, string location, int acres, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - cannot create farm {FarmName}", name);
        throw new NotImplementedException("Farm creation is not supported - Farms table doesn't exist in ODS");
    }

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public async Task<List<Contract>> GetContractsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Two-path strategy to avoid SQL Server's 2100-parameter IN-clause limit:
            // - Unfiltered: safe because Take(15) caps customer list at 15 items (well under 2100 params)
            // - Filtered: use EXISTS subqueries (Any() → SQL EXISTS) — no parameter count regardless of data volume
            List<Contract> contracts;

            if (!hasTradeUnitFilter)
            {
                // Get up to 15 customer CtrmCustomerIds (have contracts OR tickets) — 15 params = safe
                var customerCtrmIds = await _context.Customers
                    .AsNoTracking()
                    .Where(c => c.SourceCustomerId != null && (
                        _context.Contracts.Any(ct => ct.IsActive && ct.CtrmCustomerId == c.SourceCustomerId) ||
                        _context.Tickets.Any(t => t.IsActive && t.CustomerId == c.Id)))
                    .Take(15)
                    .Select(c => c.SourceCustomerId)
                    .ToListAsync(cancellationToken);

                contracts = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId))
                    .OrderByDescending(c => c.Id)
                    .ToListAsync(cancellationToken);
            }
            else
            {
                // Step 1: materialize CtrmCustomerIds from CustomerSnapshot (AppDb, indexed, ~200-300 rows)
                // filtered by TradeUnit. Avoids scanning the large ODS contracts view to find customer IDs.
                var ctrmIds = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(c => c.SourceCustomerId != null && c.IsActive && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                // Step 2: load ALL active contracts for those customers — intentionally NOT re-filtering
                // by trade unit so prior-year contracts (needed for pacing) are included even if
                // they carry a different TradeUnit value than the current selection.
                contracts = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null && ctrmIds.Contains(c.CtrmCustomerId))
                    .OrderByDescending(c => c.Id)
                    .ToListAsync(cancellationToken);
            }

            _logger.LogInformation("Loaded {ContractCount} contracts for customers who have contracts or tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
                contracts.Count, hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            return contracts;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Contracts view not accessible or missing a mapped column in this environment — returning empty list. SQL {Number}: {Error} [{TraceId}]",
                ex.Number, ex.Message, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving contracts — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    private ContractStatus CalculateContractStatus(Contract contract, DateTime today)
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

    public async Task<List<Contract>> GetContractsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with contract.CtrmCustomerId
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                return new List<Contract>();
            }

            // Match contracts using CtrmCustomerId = customer.SourceCustomerId (string matching)
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.CtrmCustomerId == customer.SourceCustomerId)
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            _logger.LogInformation("Found {ContractCount} contracts for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})",
                contracts.Count, customerId, customer.SourceCustomerId);
            return contracts;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Contracts view missing column or object for customer {CustomerId} — returning empty list. SQL {Number} [{TraceId}]",
                customerId, ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving contracts for customer {CustomerId} — returning empty list [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Contract>> GetContractsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Note: FarmId is not mapped in the current DbContext configuration
            // Returning empty list until proper mapping is established
            _logger.LogWarning("Contract.FarmId is not mapped - returning empty list for farm {FarmId}", farmId);
            return new List<Contract>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for farm {FarmId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                farmId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Contract>> GetContractsBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        try
        {
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.SourceContractId == sourceContractId)
                .ToListAsync(cancellationToken);

            var today = DateTime.Today;
            foreach (var contract in contracts)
                contract.Status = CalculateContractStatus(contract, today);

            return contracts;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for sourceContractId {SourceContractId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceContractId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => p.ContractId == sourceContractId)
                .OrderBy(p => p.PriceSequence)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for contract {ContractId}. Returning empty list. Error: {Error}", sourceContractId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        try
        {
            // base.vw_ContractPricing has no customer_id column — resolve via contracts
            var sourceContractIds = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.CtrmCustomerId == sourceCustomerId)
                .Select(c => c.SourceContractId)
                .Where(id => id != null)
                .ToListAsync(cancellationToken);

            if (sourceContractIds.Count == 0)
                return new List<ContractPricingLine>();

            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => sourceContractIds.Contains(p.ContractId))
                .OrderBy(p => p.ContractId)
                .ThenBy(p => p.PriceSequence)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for customer {CustomerId}. Returning empty list. Error: {Error}", sourceCustomerId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    // =========================================================================
    // Ticket Operations - Loads from vw_CurrentTickets in ODS
    // NOTE: ~2 million tickets exist, so queries are carefully limited
    // =========================================================================

    public async Task<List<Ticket>> GetTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Two-path strategy to avoid SQL Server's 2100-parameter IN-clause limit:
            // - Unfiltered: safe because Take(15) caps customer list at 15 items (well under 2100 params)
            // - Filtered: use EXISTS subqueries (Any() → SQL EXISTS) — no parameter count regardless of data volume
            List<Ticket> tickets;

            if (!hasTradeUnitFilter)
            {
                var customerCodes = await _context.Customers
                    .AsNoTracking()
                    .Where(c => c.SourceCustomerId != null && (
                        _context.Contracts.Any(ct => ct.IsActive && ct.CtrmCustomerId == c.SourceCustomerId) ||
                        _context.Tickets.Any(t => t.IsActive && t.CustomerCode == c.SourceCustomerId)))
                    .Take(15)
                    .Select(c => c.SourceCustomerId!)
                    .ToListAsync(cancellationToken);

                tickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerCode != null && customerCodes.Contains(t.CustomerCode))
                    .OrderByDescending(t => t.Date)
                    .ToListAsync(cancellationToken);
            }
            else
            {
                // Two-step approach: resolve customer codes AND contract numbers via the contracts
                // TradeUnit index (fast), then load tickets by CustomerCode. OrganizationCode on
                // vw_CurrentTickets has no usable index and caused full-scan queries taking 80+ seconds.
                // Contract numbers are retained so we can post-filter tickets to only those belonging
                // to this trade unit's contracts — prevents cross-TU ticket leakage for shared customers.
                var tuContracts = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null
                        && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => new { c.CtrmCustomerId, c.SourceContractId })
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var customerCodes = tuContracts.Select(c => c.CtrmCustomerId!).Distinct().ToList();
                var tuContractNumbers = tuContracts
                    .Select(c => c.SourceContractId)
                    .Where(n => n != null)
                    .ToHashSet();

                var rawTickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerCode != null && customerCodes.Contains(t.CustomerCode))
                    .OrderByDescending(t => t.Date)
                    .ToListAsync(cancellationToken);

                // Post-filter: keep tickets linked to a TU contract, or unlinked (spot/cash purchases
                // with no contract number — no way to attribute them to a specific TU).
                tickets = rawTickets
                    .Where(t => string.IsNullOrEmpty(t.CtrmContractNumber)
                             || tuContractNumbers.Contains(t.CtrmContractNumber))
                    .ToList();
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

            // Log diagnostic info about ticket-contract relationships
            var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
            var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
            var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

            _logger.LogInformation("Loaded {TicketCount} tickets — {WithContractId} have ContractId, {WithContractNumber} have CtrmContractNumber, {WithBoth} have both",
                tickets.Count, ticketsWithContractId, ticketsWithContractNumber, ticketsWithBoth);

            // Log first few tickets for debugging
            foreach (var ticket in tickets.Take(3))
            {
                _logger.LogInformation("Sample Ticket #{TicketNumber}: ContractId={ContractId}, CtrmContractNumber={CtrmContractNumber}, CustomerId={TicketCustomerId}",
                    ticket.TicketNumber, ticket.ContractId, ticket.CtrmContractNumber, ticket.CustomerId);
            }

            return tickets;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            // 207 = Invalid column name (e.g. TicketType not yet in Dev ODS view)
            // 208 = Invalid object name (view doesn't exist in this environment)
            _logger.LogWarning(ex, "Tickets view not accessible or missing a mapped column in this environment — returning empty list. SQL {Number}: {Error} [{TraceId}]",
                ex.Number, ex.Message, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving tickets — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is InvalidCastException or InvalidOperationException or OverflowException)
        {
            // EF Core type mapping mismatch (e.g. ODS column type changed) — return empty rather than 500
            _logger.LogWarning(ex, "EF Core mapping error retrieving tickets (ODS schema mismatch?) — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with ticket.CustomerCode
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                return new List<Ticket>();
            }

            // Match tickets using CustomerCode = customer.SourceCustomerId (string matching, like contracts)
            var tickets = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && t.CustomerCode == customer.SourceCustomerId)
                .OrderByDescending(t => t.Date)
                .ToListAsync(cancellationToken);

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

            _logger.LogInformation("Found {TicketCount} tickets for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})",
                tickets.Count, customerId, customer.SourceCustomerId);
            return tickets;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view missing column or object for customer {CustomerId} — returning empty list. SQL {Number} [{TraceId}]",
                customerId, ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving tickets for customer {CustomerId} — returning empty list [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Ticket>> GetTicketsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Note: FarmId is not in ODS tickets view - cannot filter by farm
            _logger.LogWarning("Ticket.FarmId is not mapped in ODS - returning empty list for farm {FarmId}", farmId);
            return new List<Ticket>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for farm {FarmId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                farmId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Planting Intention Operations - Uses dbo.ProducerPlantingIntentions table
    // =========================================================================

    public async Task<List<PlantingIntention>> GetPlantingIntentionsAsync(IEnumerable<string>? tradeUnits = null, int? plantingYear = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var query = _appContext.PlantingIntentions.AsNoTracking();
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                query = query.Where(p => tuList.Contains(p.TradeUnit));
            }
            if (plantingYear.HasValue)
            {
                query = query.Where(p => p.PlantingYear == plantingYear.Value);
            }
            var results = await query
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.CustomerName)
                .ToListAsync(cancellationToken);
            return results;
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning("PlantingIntentions not accessible (table missing or DB connection failure) — returning empty list. Error: {Error}", ex.Message);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<PlantingIntention>> GetPlantingIntentionsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.PlantingIntentions
                .AsNoTracking()
                .Where(p => p.CustomerId == customerId)
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Crop)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning("PlantingIntentions not accessible for customer {CustomerId} (table missing or DB connection failure) — returning empty list. Error: {Error}", customerId, ex.Message);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default)
        => await _appContext.PlantingIntentions.AsNoTracking().FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);

    public async Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = new PlantingIntention
            {
                CustomerId = customerId,
                CustomerName = customerName,
                CustomerCode = customerCode,
                TradeUnit = tradeUnit,
                Crop = crop,
                Type = type,
                Description = description,
                Acres = acres,
                PlantingYear = plantingYear,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };

            _appContext.PlantingIntentions.Add(intention);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Created planting intention {Id} for customer {CustomerId}", intention.Id, customerId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating planting intention for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
            if (intention == null)
            {
                return null;
            }

            intention.Crop = crop;
            intention.Type = type;
            intention.Description = description;
            intention.Acres = acres;
            intention.PlantingYear = plantingYear;
            intention.ModifiedBy = GetCurrentUser();
            intention.ModifiedAt = DateTime.UtcNow;

            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated planting intention {Id}", intentionId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating planting intention {Id} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                intentionId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeletePlantingIntentionAsync(int intentionId, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
            if (intention != null)
            {
                _appContext.PlantingIntentions.Remove(intention);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Deleted planting intention {Id}", intentionId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting planting intention {Id} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                intentionId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Note Operations - Uses dbo.Notes table in Origination database
    // =========================================================================

    public async Task<List<Note>> GetNotesAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            _logger.LogInformation("Attempting to retrieve notes from database");

            var query = _appContext.Notes.AsNoTracking();
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                query = query.Where(n => n.TradeUnit == null || tuList.Contains(n.TradeUnit));
            }
            return await query
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible (likely permissions issue). Returning empty list. Error: {Error}", ex.Message);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Note>> GetNotesByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.Notes
                .AsNoTracking()
                .Where(n => n.CustomerId == customerId)
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default)
        => await _appContext.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);

    public async Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Get customer info for denormalized fields
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId, cancellationToken);
            if (customer == null)
            {
                throw new InvalidOperationException($"Customer with ID {customerId} not found");
            }

            var note = new Note
            {
                CustomerId = customerId,
                CustomerName = customer.Name,
                CustomerCode = customer.SourceCustomerId,
                TradeUnit = tradeUnit,
                Description = content,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };

            _appContext.Notes.Add(note);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating note for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Note?> ToggleNotePinAsync(long noteId, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.IsPinned = !note.IsPinned;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error toggling pin for note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Note?> UpdateNoteAsync(long noteId, string content, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.Description = content;
            note.ModifiedBy = GetCurrentUser();
            note.ModifiedAt = DateTime.UtcNow;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated note {NoteId}", noteId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteNoteAsync(long noteId, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return;
            }

            _appContext.Notes.Remove(note);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Deleted note {NoteId}", noteId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Producer Details Operations - Uses dbo.ProducerDetails table in Origination database
    // =========================================================================

    public async Task<ProducerDetails?> GetProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.ProducerDetails.AsNoTracking().FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving producer details for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<ProducerDetails>> GetAllProducerDetailsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.ProducerDetails.AsNoTracking().ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<ProducerDetails>();
        }
    }

    public async Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

            if (existing != null)
            {
                existing.SourceCustomerId = sourceCustomerId;
                existing.CustomerName = customerName;
                existing.TotalAcres = totalAcres;
                existing.BinCapacity = binCapacity;
                existing.PrimaryContact = primaryContact;
                existing.Commodities = commodities;
                existing.LinkedProducerIds = linkedProducerIds;
                existing.ModifiedBy = GetCurrentUser();
                existing.ModifiedAt = DateTime.UtcNow;

                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Updated ProducerDetails for customer {CustomerId}", customerId);
                return existing;
            }
            else
            {
                var details = new ProducerDetails
                {
                    CustomerId = customerId,
                    SourceCustomerId = sourceCustomerId,
                    CustomerName = customerName,
                    TotalAcres = totalAcres,
                    BinCapacity = binCapacity,
                    PrimaryContact = primaryContact,
                    Commodities = commodities,
                    LinkedProducerIds = linkedProducerIds,
                    CreatedBy = GetCurrentUser(),
                    CreatedAt = DateTime.UtcNow
                };

                _appContext.ProducerDetails.Add(details);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Created ProducerDetails for customer {CustomerId}", customerId);
                return details;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error upserting ProducerDetails for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
            if (existing != null)
            {
                _appContext.ProducerDetails.Remove(existing);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Deleted ProducerDetails for customer {CustomerId}", customerId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting ProducerDetails for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Storage Operations — ctrm.vw_GNTA39D1 joined with originations.vw_CurrentCustomers
    // =========================================================================

    private const string StoredGrainSql = """
        SELECT
            CAST(sg.WHR_RECEIPT_NUMBER AS varchar(50)) + '|' + ISNULL(sg.LOCATION_CODE, '') AS Id,
            CAST(sg.WHR_RECEIPT_NUMBER AS varchar(50)) AS ReceiptNumber,
            c.CustomerId AS CustomerId,
            sg.CUSTOMER_ID AS CustomerCode,
            ISNULL(sg.COMMODITY_CODE, '') AS Crop,
            ISNULL(sg.NET_QUANTITY, 0) AS Quantity,
            ISNULL(sg.INITIAL_STORAGE_DATE, '1900-01-01') AS StorageStartDate,
            ISNULL(sg.STORAGE_RATE, 0) AS StorageRate,
            ISNULL(sg.LOCATION_CODE, '') AS Bin
        FROM ctrm.vw_GNTA39D1 sg
        INNER JOIN originations.vw_CurrentCustomers c ON sg.CUSTOMER_ID = c.SourceCustomerId
        """;

    public async Task<List<StoredGrain>> GetStoredGrainAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var tuList = tradeUnits?.ToList();
            if (tuList is { Count: > 0 })
            {
                var paramNames = tuList.Select((_, i) => $"@tu{i}").ToArray();
                var sql = StoredGrainSql + $" WHERE c.TradeUnit IN ({string.Join(", ", paramNames)})";
                var sqlParams = tuList.Select((tu, i) => new SqlParameter($"@tu{i}", tu)).ToArray<object>();
                return await _context.Database
                    .SqlQueryRaw<StoredGrain>(sql, sqlParams)
                    .ToListAsync(cancellationToken);
            }
            return await _context.Database
                .SqlQueryRaw<StoredGrain>(StoredGrainSql)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain");
            return [];
        }
    }

    public async Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            var sql = StoredGrainSql + " WHERE c.CustomerId = @customerId";
            return await _context.Database
                .SqlQueryRaw<StoredGrain>(sql, new SqlParameter("@customerId", customerId))
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain for customer {CustomerId}", customerId);
            return [];
        }
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public async Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var currentUser = GetCurrentUser();
            return await _appContext.SavedLists
                .AsNoTracking()
                .Where(s => s.IsActive && s.CreatedBy == currentUser)
                .OrderByDescending(s => s.CreatedAt)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving saved lists [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<SavedList> SaveListAsync(string name, string query, string? tradeUnits, string? filters = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var savedList = new SavedList
            {
                Name = name,
                Query = query,
                TradeUnits = tradeUnits,
                Filters = filters,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };
            _appContext.SavedLists.Add(savedList);
            await _appContext.SaveChangesAsync(cancellationToken);
            return savedList;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving list [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<SavedList?> UpdateListAsync(int listId, string name, string query, string? tradeUnits, string? filters = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var currentUser = GetCurrentUser();
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == currentUser, cancellationToken);
            if (list == null) return null;
            list.Name = name;
            list.Query = query;
            list.TradeUnits = tradeUnits;
            list.Filters = filters;
            list.ModifiedAt = DateTime.UtcNow;
            list.ModifiedBy = currentUser;
            await _appContext.SaveChangesAsync(cancellationToken);
            return list;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating saved list {ListId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                listId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteListAsync(int listId, CancellationToken cancellationToken = default)
    {
        try
        {
            var currentUser = GetCurrentUser();
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == currentUser, cancellationToken);
            if (list == null) return;
            _appContext.SavedLists.Remove(list);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting saved list {ListId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                listId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    public async Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardPlantingEstimates
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, string username, CancellationToken cancellationToken = default)
    {
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
            foreach (var req in estimates)
            {
                var existing = await _appContext.DashboardPlantingEstimates
                    .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                          && e.Crop == req.Crop
                                          && e.PlantingYear == req.PlantingYear, cancellationToken);
                if (req.YieldEstimate == null)
                {
                    if (existing != null)
                        _appContext.DashboardPlantingEstimates.Remove(existing);
                }
                else if (existing != null)
                {
                    existing.YieldEstimate = req.YieldEstimate;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardPlantingEstimates.Add(new DashboardPlantingEstimate
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        Crop = req.Crop,
                        PlantingYear = req.PlantingYear,
                        YieldEstimate = req.YieldEstimate,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task<List<DashboardMarketShare>> GetDashboardMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardMarketShares
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, string username, CancellationToken cancellationToken = default)
    {
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
            foreach (var req in shares)
            {
                var existing = await _appContext.DashboardMarketShares
                    .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                          && e.CropCategory == req.CropCategory
                                          && e.PlantingYear == req.PlantingYear, cancellationToken);
                if (req.MarketSharePct == null)
                {
                    if (existing != null)
                        _appContext.DashboardMarketShares.Remove(existing);
                }
                else if (existing != null)
                {
                    existing.MarketSharePct = req.MarketSharePct;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardMarketShares.Add(new DashboardMarketShare
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        CropCategory = req.CropCategory,
                        PlantingYear = req.PlantingYear,
                        MarketSharePct = req.MarketSharePct,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    // Dashboard Actual Harvest Operations
    public async Task<List<DashboardActualHarvest>> GetDashboardActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, string username, CancellationToken cancellationToken = default)
    {
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
            foreach (var req in items)
            {
                var existing = await _appContext.DashboardActualHarvests
                    .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                          && e.CropCategory == req.CropCategory
                                          && e.PlantingYear == req.PlantingYear, cancellationToken);
                if (existing != null)
                {
                    existing.Bushels = req.Bushels;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardActualHarvests.Add(new DashboardActualHarvest
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        CropCategory = req.CropCategory,
                        PlantingYear = req.PlantingYear,
                        Bushels = req.Bushels,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task DeleteDashboardActualHarvestAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _appContext.DashboardActualHarvests.FindAsync([id], cancellationToken);
        if (entity != null)
        {
            _appContext.DashboardActualHarvests.Remove(entity);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    // =========================================================================
    // Bid Sheet Operations
    // =========================================================================

    public async Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode = null, CancellationToken cancellationToken = default)
    {
        var query = _appContext.ElevatorCaches.AsNoTracking().Where(e => e.IsActive);

        if (!string.IsNullOrEmpty(tradeUnitCode))
            query = query.Where(e => e.TradeUnitCode == tradeUnitCode);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<List<BidSheetEntry>> GetBidSheetEntriesAsync(string tradeUnitCode, int? cropYear = null, string? commodityCode = null, CancellationToken cancellationToken = default)
    {
        var query = _appContext.BidSheetEntries
            .AsNoTracking()
            .Where(e => e.TradeUnitCode == tradeUnitCode);

        if (cropYear.HasValue)
            query = query.Where(e => e.CropYear == cropYear.Value);

        if (!string.IsNullOrEmpty(commodityCode))
            query = query.Where(e => e.CommodityCode == commodityCode);

        return await query.OrderByDescending(e => e.CreatedAt).ToListAsync(cancellationToken);
    }

    public async Task<BidSheetEntry> CreateBidSheetEntryAsync(BidSheetEntry entry, CancellationToken cancellationToken = default)
    {
        _appContext.BidSheetEntries.Add(entry);
        await _appContext.SaveChangesAsync(cancellationToken);
        return entry;
    }

    public async Task<BidSheetEntry?> UpdateBidSheetEntryAsync(int id, BidSheetEntry entry, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetEntries.FindAsync([id], cancellationToken);
        if (existing == null) return null;

        existing.Name = entry.Name;
        existing.Address = entry.Address;
        existing.City = entry.City;
        existing.State = entry.State;
        existing.Latitude = entry.Latitude;
        existing.Longitude = entry.Longitude;
        existing.Bid = entry.Bid;
        existing.ModifiedBy = entry.ModifiedBy;
        existing.ModifiedAt = DateTime.UtcNow;

        await _appContext.SaveChangesAsync(cancellationToken);
        return existing;
    }

    public async Task DeleteBidSheetEntryAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetEntries.FindAsync([id], cancellationToken);
        if (existing != null)
        {
            _appContext.BidSheetEntries.Remove(existing);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task BulkCreateBidSheetEntriesAsync(List<BidSheetEntry> entries, CancellationToken cancellationToken = default)
    {
        if (entries.Count == 0) return;
        await _appContext.BidSheetEntries.AddRangeAsync(entries, cancellationToken);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<BidReference?> GetBidReferenceAsync(string userId, string tradeUnitCode, string commodityCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidReferences
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TradeUnitCode == tradeUnitCode && r.CommodityCode == commodityCode, cancellationToken);
    }

    public async Task SetBidReferenceAsync(BidReference reference, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidReferences
            .FirstOrDefaultAsync(r => r.UserId == reference.UserId && r.TradeUnitCode == reference.TradeUnitCode && r.CommodityCode == reference.CommodityCode, cancellationToken);

        if (existing != null)
        {
            existing.ElevatorCode = reference.ElevatorCode;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        else
        {
            reference.ModifiedAt = DateTime.UtcNow;
            _appContext.BidReferences.Add(reference);
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetEntries
            .AsNoTracking()
            .Where(e => e.TradeUnitCode == tradeUnitCode)
            .Select(e => e.CropYear)
            .Distinct()
            .OrderBy(y => y)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetEntries
            .AsNoTracking()
            .Where(e => e.TradeUnitCode == tradeUnitCode)
            .Select(e => e.CommodityCode)
            .Distinct()
            .OrderBy(c => c)
            .ToListAsync(cancellationToken);
    }
}
