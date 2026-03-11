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

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.AsNoTracking().Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = await contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToListAsync(cancellationToken);

            // Build ticket query with optional organization code filter
            var ticketQuery = _context.Tickets.AsNoTracking().Where(t => t.IsActive && t.CustomerId.HasValue);
            if (hasTradeUnitFilter)
            {
                ticketQuery = ticketQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = await ticketQuery
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToListAsync(cancellationToken);

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units: {string.Join(", ", tradeUnits)})" : "";
            _logger.LogInformation($"Found {customerIdsWithContracts.Count} customers with contracts, {customerIdsWithTickets.Count} customers with tickets{filterMsg}");

            // originations.vw_CurrentCustomers is pre-filtered to active PR customers, excluding
            // DUP / DO NOT USE / symbol-prefixed names — no redundant filters needed here.
            // Include customers who have contracts OR tickets in the trade unit.
            // When trade units are selected, return all matching customers; otherwise limit to 15.
            var customerQuery = _context.Customers
                .AsNoTracking()
                .Where(c => customerIdsWithContracts.Contains(c.SourceCustomerId) ||
                            customerIdsWithTickets.Contains(c.Id))
                .OrderBy(c => c.Name);

            var customers = hasTradeUnitFilter
                ? await customerQuery.ToListAsync(cancellationToken)
                : await customerQuery.Take(15).ToListAsync(cancellationToken);

            await EnrichCustomersWithESignAsync(customers, cancellationToken);
            _logger.LogInformation($"Returning {customers.Count} producer customers who have contracts or tickets{filterMsg}");
            return customers;
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

            // Split search term into words for flexible matching
            // Example: "Jim Johnson" will match "Johnson, Jim R" because both "Jim" and "Johnson" are in the name
            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();

            // If trade unit filter is applied, get customer IDs that have contracts/tickets in those trade units
            List<string>? customerIdsWithTradeUnitContracts = null;
            List<long>? customerIdsWithTradeUnitTickets = null;

            if (hasTradeUnitFilter)
            {
                customerIdsWithTradeUnitContracts = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                customerIdsWithTradeUnitTickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerId.HasValue && t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode))
                    .Select(t => t.CustomerId!.Value)
                    .Distinct()
                    .ToListAsync(cancellationToken);
            }

            // originations.vw_CurrentCustomers is pre-filtered — start with all customers in the view
            var query = _context.Customers.AsNoTracking().AsQueryable();

            // Add trade unit filter if specified
            if (customerIdsWithTradeUnitContracts != null && customerIdsWithTradeUnitTickets != null)
            {
                query = query.Where(c =>
                    (c.SourceCustomerId != null && customerIdsWithTradeUnitContracts.Contains(c.SourceCustomerId)) ||
                    customerIdsWithTradeUnitTickets.Contains(c.Id));
            }

            // Add Contains condition for each search word (all words must match name OR sourceCustomerId)
            foreach (var word in searchWords)
            {
                query = query.Where(c => c.Name.Contains(word) || (c.SourceCustomerId != null && c.SourceCustomerId.Contains(word)));
            }

            // Get candidates (without ordering in SQL - we'll order by relevance in memory)
            // When trade units are selected, get more candidates; otherwise limit to 100
            var candidates = await query
                .Take(hasTradeUnitFilter ? 1000 : 100)
                .ToListAsync(cancellationToken);

            // Score each customer by relevance
            var scoredResults = candidates.Select(c => new
            {
                Customer = c,
                Score = CalculateRelevanceScore(c.Name, searchWords, searchTerm)
            })
            .OrderByDescending(x => x.Score) // Most relevant first
            .ThenBy(x => x.Customer.Name);    // Then alphabetically for ties

            // Only limit to 15 when no trade units are selected
            var scoredCustomers = hasTradeUnitFilter
                ? scoredResults.Select(x => x.Customer).ToList()
                : scoredResults.Take(15).Select(x => x.Customer).ToList();

            await EnrichCustomersWithESignAsync(scoredCustomers, cancellationToken);
            _logger.LogInformation($"Search for '{searchTerm}' returned {scoredCustomers.Count} producer customers (ranked by relevance)");
            return scoredCustomers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching customers for term: {SearchTerm} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                searchTerm, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

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

        // Table only contains enrolled customers (eSignEnabled = true).
        // Presence in table = enrolled; absence = not enrolled.
        var enrollmentList = await _appContext.ESignEnrollments
            .AsNoTracking()
            .Where(e => codes.Contains(e.CustomerCode))
            .ToListAsync(cancellationToken);

        var enrollments = enrollmentList
            .GroupBy(e => e.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var customer in customers)
        {
            if (customer.SourceCustomerId != null &&
                enrollments.TryGetValue(customer.SourceCustomerId, out var enrollment))
            {
                customer.ESignEnabled = true;
                customer.ScoularViewRecipients = enrollment.ScoularViewRecipients;
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

            return allCommodities.OrderBy(c => c.Name).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
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

    public Task<List<Farm>> GetFarmsAsync(CancellationToken cancellationToken = default)
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

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.AsNoTracking().Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = await contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToListAsync(cancellationToken);

            // Build ticket query with optional organization code filter
            var ticketQuery = _context.Tickets.AsNoTracking().Where(t => t.IsActive && t.CustomerId.HasValue);
            if (hasTradeUnitFilter)
            {
                ticketQuery = ticketQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = await ticketQuery
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToListAsync(cancellationToken);

            // originations.vw_CurrentCustomers is pre-filtered — no redundant filters needed.
            var customerQuery = _context.Customers
                .AsNoTracking()
                .Where(c => customerIdsWithContracts.Contains(c.SourceCustomerId) ||
                            customerIdsWithTickets.Contains(c.Id))
                .OrderBy(c => c.Name);

            var customerCtrmIds = hasTradeUnitFilter
                ? await customerQuery.Select(c => c.SourceCustomerId).ToListAsync(cancellationToken)
                : await customerQuery.Take(15).Select(c => c.SourceCustomerId).ToListAsync(cancellationToken);

            // Get all contracts for those customers — intentionally NOT filtering by trade unit here
            // so that prior-year contracts (needed for pacing calculations) are included even if
            // they carry a different TradeUnit value than the current selection.
            var contractsQuery = _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId));

            var contracts = await contractsQuery
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            _logger.LogInformation($"Loaded {contracts.Count} contracts for customers who have contracts or tickets{filterMsg}");

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            return contracts;
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

            _logger.LogInformation($"Found {contracts.Count} contracts for customer {customerId} (SourceCustomerId: {customer.SourceCustomerId})");
            return contracts;
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
            _logger.LogError(ex, "Error retrieving pricing lines for contract {ContractId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceContractId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => p.CustomerId == sourceCustomerId)
                .OrderBy(p => p.ContractId)
                .ThenBy(p => p.PriceSequence)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving pricing lines for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceCustomerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
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

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.AsNoTracking().Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = await contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToListAsync(cancellationToken);

            // Build ticket query with optional organization code filter
            var ticketQueryBase = _context.Tickets.AsNoTracking().Where(t => t.IsActive && t.CustomerCode != null);
            if (hasTradeUnitFilter)
            {
                ticketQueryBase = ticketQueryBase.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer codes that have tickets (via CustomerCode)
            var customerCodesWithTickets = await ticketQueryBase
                .Select(t => t.CustomerCode!)
                .Distinct()
                .ToListAsync(cancellationToken);

            // originations.vw_CurrentCustomers is pre-filtered — no redundant filters needed.
            var customerQuery = _context.Customers
                .AsNoTracking()
                .Where(c => c.SourceCustomerId != null &&
                            (customerIdsWithContracts.Contains(c.SourceCustomerId) ||
                             customerCodesWithTickets.Contains(c.SourceCustomerId)))
                .OrderBy(c => c.Name);

            var producerCustomerCodes = hasTradeUnitFilter
                ? await customerQuery.Select(c => c.SourceCustomerId!).ToListAsync(cancellationToken)
                : await customerQuery.Take(15).Select(c => c.SourceCustomerId!).ToListAsync(cancellationToken);

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            var customerCountMsg = hasTradeUnitFilter ? $"all {producerCustomerCodes.Count} customers" : "top 15 customers";
            _logger.LogInformation($"Loading tickets for {customerCountMsg} who have contracts or tickets{filterMsg}");

            // Load all tickets for those producer customers using string matching (CustomerCode = SourceCustomerId)
            var ticketsQuery = _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && t.CustomerCode != null && producerCustomerCodes.Contains(t.CustomerCode));

            // Apply trade unit filter if specified
            if (hasTradeUnitFilter)
            {
                ticketsQuery = ticketsQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            var tickets = await ticketsQuery
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

                    // GradeCode is already loaded from base.Ticket table
                }

                if ((ticket.ProductCode ?? "").ToLower().Contains("wheat"))
                    wheatTickets++;
            }

            _logger.LogInformation($"Quality data: {ticketsWithProtein} tickets have protein data, {wheatTickets} wheat tickets found");

            // Log diagnostic info about ticket-contract relationships
            var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
            var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
            var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

            _logger.LogInformation($"Loaded {tickets.Count} tickets for customers who have contracts or tickets{filterMsg}");
            _logger.LogInformation($"  - {ticketsWithContractId} tickets have ContractId");
            _logger.LogInformation($"  - {ticketsWithContractNumber} tickets have CtrmContractNumber");
            _logger.LogInformation($"  - {ticketsWithBoth} tickets have both");

            // Log first few tickets for debugging
            foreach (var ticket in tickets.Take(3))
            {
                _logger.LogInformation($"Sample Ticket #{ticket.TicketNumber}: ContractId={ticket.ContractId}, CtrmContractNumber={ticket.CtrmContractNumber}, CustomerId={ticket.CustomerId}");
            }

            return tickets;
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

            _logger.LogInformation($"Found {tickets.Count} tickets for customer {customerId} (SourceCustomerId: {customer.SourceCustomerId})");
            return tickets;
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

    public async Task<List<PlantingIntention>> GetPlantingIntentionsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.PlantingIntentions
                .AsNoTracking()
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.CustomerName)
                .ToListAsync(cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("ProducerPlantingIntentions table not accessible. Returning empty list. Error: {Error}", ex.Message);
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
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("ProducerPlantingIntentions table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

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

    public async Task<List<Note>> GetNotesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            _logger.LogInformation("Attempting to retrieve notes from database");

            return await _appContext.Notes
                .AsNoTracking()
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
    // Storage Operations - DISABLED: Table doesn't exist in ODS
    // =========================================================================

    public Task<List<StoredGrain>> GetStoredGrainAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<StoredGrain>());
    }

    public Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<StoredGrain>());
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public async Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            return await _appContext.SavedLists
                .AsNoTracking()
                .Where(s => s.IsActive)
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
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId, cancellationToken);
            if (list == null) return null;
            list.Name = name;
            list.Query = query;
            list.TradeUnits = tradeUnits;
            list.Filters = filters;
            list.ModifiedAt = DateTime.UtcNow;
            list.ModifiedBy = GetCurrentUser();
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
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId, cancellationToken);
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
        await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
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
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
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
        await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
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
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
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
        await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
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
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
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
}
