using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using GrainOriginatorPortal.Api.Data;
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

    private string GetCurrentUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        return user?.FindFirst("name")?.Value
            ?? user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst("upn")?.Value
            ?? user?.FindFirst("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")?.Value
            ?? user?.Identity?.Name
            ?? "Unknown";
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public async Task<List<Customer>> GetCustomers(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;
            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units: {string.Join(", ", tradeUnits)})" : "";

            List<Customer> customers;

            if (hasTradeUnitFilter)
            {
                // Single view query — originations.vw_CustomerTradeUnits already joins contracts + tickets
                var rows = await _context.CustomerTradeUnits
                    .AsNoTracking()
                    .Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .ToListAsync();

                customers = rows
                    .GroupBy(r => r.CustomerId)
                    .Select(g => g.First().ToCustomer())
                    .OrderBy(c => c.Name)
                    .ToList();
            }
            else
            {
                // No filter — return top 15 from customers view directly
                customers = await _context.Customers
                    .AsNoTracking()
                    .OrderBy(c => c.Name)
                    .Take(15)
                    .ToListAsync();
            }

            await EnrichCustomersWithESign(customers);
            _logger.LogInformation("Returning {CustomerCount} producer customers who have contracts or tickets{Filter}", customers.Count, filterMsg);
            return customers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers");
            throw;
        }
    }

    public async Task<List<Customer>> SearchCustomers(string searchTerm, List<string>? tradeUnits = null)
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
                    .ToListAsync();

                customerIdsWithTradeUnitTickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerId.HasValue && t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode))
                    .Select(t => t.CustomerId!.Value)
                    .Distinct()
                    .ToListAsync();
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
                .ToListAsync();

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

            await EnrichCustomersWithESign(scoredCustomers);
            _logger.LogInformation("Search for {SearchTerm} returned {CustomerCount} producer customers (ranked by relevance)", searchTerm, scoredCustomers.Count);
            return scoredCustomers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching customers for term: {SearchTerm}", searchTerm);
            throw;
        }
    }

    /// <summary>
    /// Looks up eSign enrollment records for the given customers and populates
    /// ESignEnabled and ScoularViewRecipients from dbo.eSignEnrollment.
    /// </summary>
    private async Task EnrichCustomersWithESign(List<Customer> customers)
    {
        if (customers.Count == 0) return;

        var codes = customers
            .Where(c => c.SourceCustomerId != null)
            .Select(c => c.SourceCustomerId!)
            .Distinct()
            .ToList();

        var enrollments = (await _appContext.ESignEnrollments
            .AsNoTracking()
            .Where(e => codes.Contains(e.CustomerCode))
            .ToListAsync())
            .ToDictionary(e => e.CustomerCode, e => e);

        foreach (var customer in customers)
        {
            if (customer.SourceCustomerId != null &&
                enrollments.TryGetValue(customer.SourceCustomerId, out var enrollment))
            {
                customer.ESignEnabled = enrollment.ESignEnabled;
                customer.ScoularViewRecipients = enrollment.ScoularViewRecipients;
                customer.Guild = enrollment.Guild;
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

    public async Task<Customer?> GetCustomerById(long id)
    {
        try
        {
            return await _context.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && c.IsActive);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer {CustomerId}", id);
            throw;
        }
    }

    public async Task UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds)
    {
        try
        {
            var customer = await _context.Customers.FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive);
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

            await _context.SaveChangesAsync();
            _logger.LogInformation("Updated customer {CustomerId}", customerId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating customer {CustomerId}", customerId);
            throw;
        }
    }

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public async Task<List<string>> GetTradeUnits()
    {
        try
        {
            var cachedTradeUnits = await _appContext.TradeUnits
                .Where(tu => tu.IsActive)
                .Select(tu => tu.Code)
                .OrderBy(c => c)
                .ToListAsync();

            if (cachedTradeUnits.Count > 0)
            {
                _logger.LogInformation("Returning {Count} trade units from dbo.TradeUnits", cachedTradeUnits.Count);
                return cachedTradeUnits;
            }

            // Table is empty - one-time population from ODS
            _logger.LogInformation("dbo.TradeUnits is empty - performing one-time population from ODS");
            var tradeUnitsFromOds = await GetTradeUnitsFromViews();

            foreach (var code in tradeUnitsFromOds)
            {
                _appContext.TradeUnits.Add(new TradeUnit { Code = code, IsActive = true });
            }
            await _appContext.SaveChangesAsync();
            return tradeUnitsFromOds;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade units");
            throw;
        }
    }

    private async Task<List<string>> GetTradeUnitsFromViews()
    {
        // Get unique trade units from contracts
        var contractTradeUnits = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && !string.IsNullOrEmpty(c.TradeUnit))
            .Select(c => c.TradeUnit!)
            .Distinct()
            .ToListAsync();

        // Get unique organization codes from tickets
        var ticketOrgCodes = await _context.Tickets
            .AsNoTracking()
            .Where(t => t.IsActive && !string.IsNullOrEmpty(t.OrganizationCode))
            .Select(t => t.OrganizationCode!)
            .Distinct()
            .ToListAsync();

        // Combine and return unique sorted list
        return contractTradeUnits
            .Union(ticketOrgCodes)
            .OrderBy(tu => tu)
            .ToList();
    }

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    public async Task<List<Commodity>> GetCommodities()
    {
        try
        {
            var existingCodes = new HashSet<string>(
                await _appContext.Commodities.Where(c => c.IsActive).Select(c => c.Code).ToListAsync(),
                StringComparer.OrdinalIgnoreCase
            );

            // Pull all commodity data from contracts (Code, Name, Category)
            var contractCommodities = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive
                    && !string.IsNullOrEmpty(c.CommodityCode)
                    && !string.IsNullOrEmpty(c.CommodityDescription))
                .Select(c => new { c.CommodityCode, c.CommodityDescription, c.CommodityGroup })
                .Distinct()
                .ToListAsync();

            // Pull all distinct product codes from tickets
            var ticketProductCodes = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && !string.IsNullOrEmpty(t.ProductCode))
                .Select(t => t.ProductCode!)
                .Distinct()
                .ToListAsync();

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
            var allCommodities = await _appContext.Commodities.Where(c => c.IsActive).ToListAsync();
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
                await _appContext.SaveChangesAsync();
                _logger.LogInformation("Synced commodities from ODS - now {Count} total", allCommodities.Count);
            }

            return allCommodities.OrderBy(c => c.Name).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving commodities");
            throw;
        }
    }

    public async Task<List<TradeUnitGroup>> GetTradeUnitGroups()
    {
        try
        {
            var groups = await _appContext.TradeUnitGroups
                .AsNoTracking()
                .Where(g => g.IsActive)
                .Include(g => g.TradeUnits.Where(tu => tu.IsActive))
                .OrderBy(g => g.GroupName)
                .ToListAsync();

            _logger.LogInformation("Returning {Count} trade unit groups", groups.Count);
            return groups;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade unit groups");
            throw;
        }
    }

    // =========================================================================
    // Farm Operations - DISABLED: Farms table doesn't exist in ODS
    // =========================================================================

    public Task<List<Farm>> GetFarms()
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<Farm>());
    }

    public Task<List<Farm>> GetFarmsByCustomer(long customerId)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return Task.FromResult(new List<Farm>());
    }

    public Task<Farm?> GetFarmById(string id)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning null for farm {FarmId}", id);
        return Task.FromResult<Farm?>(null);
    }

    public Task<string> CreateFarm(string name, string location, int acres)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - cannot create farm {FarmName}", name);
        throw new NotImplementedException("Farm creation is not supported - Farms table doesn't exist in ODS");
    }

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public async Task<List<Contract>> GetContracts(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            List<string?> customerCtrmIds;
            if (hasTradeUnitFilter)
            {
                // Single view query — originations.vw_CustomerTradeUnits already joins contracts + tickets
                customerCtrmIds = await _context.CustomerTradeUnits
                    .AsNoTracking()
                    .Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.SourceCustomerId)
                    .Distinct()
                    .ToListAsync();
            }
            else
            {
                // No filter — original approach for top 15 customers
                var idsWithContracts = await _context.Contracts.AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null)
                    .Select(c => c.CtrmCustomerId)
                    .Distinct()
                    .ToListAsync();
                var idsWithTickets = await _context.Tickets.AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerId.HasValue)
                    .Select(t => t.CustomerId!.Value)
                    .Distinct()
                    .ToListAsync();
                customerCtrmIds = await _context.Customers
                    .AsNoTracking()
                    .Where(c => idsWithContracts.Contains(c.SourceCustomerId) || idsWithTickets.Contains(c.Id))
                    .OrderBy(c => c.Name)
                    .Take(15)
                    .Select(c => c.SourceCustomerId)
                    .ToListAsync();
            }

            // Get all contracts for those customers — intentionally NOT filtering by trade unit here
            // so that prior-year contracts (needed for pacing calculations) are included even if
            // they carry a different TradeUnit value than the current selection.
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId))
                .OrderByDescending(c => c.Id)
                .ToListAsync();

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            _logger.LogInformation("Loaded {ContractCount} contracts for customers who have contracts or tickets{Filter}", contracts.Count, filterMsg);

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
            _logger.LogError(ex, "Error retrieving contracts");
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

    public async Task<List<Contract>> GetContractsByCustomer(long customerId)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with contract.CtrmCustomerId
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive);
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
                .ToListAsync();

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            _logger.LogInformation("Found {ContractCount} contracts for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})", contracts.Count, customerId, customer.SourceCustomerId);
            return contracts;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for customer {CustomerId}", customerId);
            throw;
        }
    }

    public Task<List<Contract>> GetContractsByFarm(string farmId)
    {
        _logger.LogWarning("Contract.FarmId is not mapped - returning empty list for farm {FarmId}", farmId);
        return Task.FromResult(new List<Contract>());
    }

    public async Task<List<ContractPricingLine>> GetPricingLines(string sourceContractId)
    {
        try
        {
            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => p.ContractId == sourceContractId)
                .OrderBy(p => p.PriceSequence)
                .ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving pricing lines for contract {ContractId}", sourceContractId);
            throw;
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomer(string sourceCustomerId)
    {
        try
        {
            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => p.CustomerId == sourceCustomerId)
                .OrderBy(p => p.ContractId)
                .ThenBy(p => p.PriceSequence)
                .ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving pricing lines for customer {CustomerId}", sourceCustomerId);
            throw;
        }
    }

    // =========================================================================
    // Ticket Operations - Loads from vw_CurrentTickets in ODS
    // NOTE: ~2 million tickets exist, so queries are carefully limited
    // =========================================================================

    public async Task<List<Ticket>> GetTickets(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            List<string> producerCustomerCodes;
            if (hasTradeUnitFilter)
            {
                // Single view query — originations.vw_CustomerTradeUnits already joins contracts + tickets
                producerCustomerCodes = (await _context.CustomerTradeUnits
                    .AsNoTracking()
                    .Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.SourceCustomerId)
                    .Distinct()
                    .ToListAsync())
                    .Where(id => id != null)
                    .Select(id => id!)
                    .ToList();
            }
            else
            {
                // No filter — original approach for top 15 customers
                var idsWithContracts = await _context.Contracts.AsNoTracking()
                    .Where(c => c.IsActive && c.CtrmCustomerId != null)
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync();
                var codesWithTickets = await _context.Tickets.AsNoTracking()
                    .Where(t => t.IsActive && t.CustomerCode != null)
                    .Select(t => t.CustomerCode!)
                    .Distinct()
                    .ToListAsync();
                producerCustomerCodes = await _context.Customers
                    .AsNoTracking()
                    .Where(c => c.SourceCustomerId != null &&
                                (idsWithContracts.Contains(c.SourceCustomerId) ||
                                 codesWithTickets.Contains(c.SourceCustomerId)))
                    .OrderBy(c => c.Name)
                    .Take(15)
                    .Select(c => c.SourceCustomerId!)
                    .ToListAsync();
            }

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            var customerCountMsg = hasTradeUnitFilter ? $"all {producerCustomerCodes.Count} customers" : "top 15 customers";
            _logger.LogInformation("Loading tickets for {CustomerCount} who have contracts or tickets{Filter}", customerCountMsg, filterMsg);

            var ticketsQuery = _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && t.CustomerCode != null && producerCustomerCodes.Contains(t.CustomerCode));
            if (hasTradeUnitFilter)
                ticketsQuery = ticketsQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));

            var tickets = (await ticketsQuery.ToListAsync())
                .OrderByDescending(t => t.ParsedDate)
                .ToList();

            // Load quality data for these tickets
            var ticketIds = tickets.Select(t => t.Id).ToList();
            var qualityData = await _context.TicketQualities
                .AsNoTracking()
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToDictionaryAsync(q => q.TicketId);

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

            _logger.LogInformation("Quality data: {ProteinTickets} tickets have protein data, {WheatTickets} wheat tickets found", ticketsWithProtein, wheatTickets);

            // Log diagnostic info about ticket-contract relationships
            var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
            var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
            var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

            _logger.LogInformation("Loaded {TicketCount} tickets for customers who have contracts or tickets{Filter}", tickets.Count, filterMsg);
            _logger.LogInformation("  - {WithContractId} tickets have ContractId", ticketsWithContractId);
            _logger.LogInformation("  - {WithContractNumber} tickets have CtrmContractNumber", ticketsWithContractNumber);
            _logger.LogInformation("  - {WithBoth} tickets have both", ticketsWithBoth);

            // Log first few tickets for debugging
            foreach (var ticket in tickets.Take(3))
            {
                _logger.LogInformation("Sample Ticket #{TicketNumber}: ContractId={ContractId}, CtrmContractNumber={CtrmContractNumber}, CustomerId={CustomerId}", ticket.TicketNumber, ticket.ContractId, ticket.CtrmContractNumber, ticket.CustomerId);
            }

            return tickets;
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("Tickets table not accessible. Returning empty list.");
            return new List<Ticket>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets");
            throw;
        }
    }

    public async Task<List<Ticket>> GetTicketsByCustomer(long customerId)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with ticket.CustomerCode
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                return new List<Ticket>();
            }

            // Match tickets using CustomerCode = customer.SourceCustomerId (string matching, like contracts)
            var tickets = (await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && t.CustomerCode == customer.SourceCustomerId)
                .ToListAsync())
                .OrderByDescending(t => t.ParsedDate)
                .ToList();

            // Load quality data for these tickets
            var ticketIds = tickets.Select(t => t.Id).ToList();
            var qualityData = (await _context.TicketQualities
                .AsNoTracking()
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToListAsync())
                .ToDictionary(q => q.TicketId);

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

            _logger.LogInformation("Found {TicketCount} tickets for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})", tickets.Count, customerId, customer.SourceCustomerId);
            return tickets;
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("Tickets table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<Ticket>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for customer {CustomerId}", customerId);
            throw;
        }
    }

    public Task<List<Ticket>> GetTicketsByFarm(string farmId)
    {
        _logger.LogWarning("Ticket.FarmId is not mapped in ODS - returning empty list for farm {FarmId}", farmId);
        return Task.FromResult(new List<Ticket>());
    }

    // =========================================================================
    // Planting Intention Operations - Uses dbo.ProducerPlantingIntentions table
    // =========================================================================

    public async Task<List<PlantingIntention>> GetPlantingIntentions()
    {
        try
        {
            return await _appContext.PlantingIntentions
                .AsNoTracking()
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.CustomerName)
                .ToListAsync();
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("ProducerPlantingIntentions table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions");
            throw;
        }
    }

    public async Task<List<PlantingIntention>> GetPlantingIntentionsByCustomer(long customerId)
    {
        try
        {
            return await _appContext.PlantingIntentions
                .AsNoTracking()
                .Where(p => p.CustomerId == customerId)
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Crop)
                .ToListAsync();
        }
        catch (SqlException ex) when (ex.Number == 208)
        {
            _logger.LogWarning("ProducerPlantingIntentions table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions for customer {CustomerId}", customerId);
            throw;
        }
    }

    public async Task<PlantingIntention> AddPlantingIntention(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear)
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
                CreatedOn = DateTime.UtcNow
            };

            _appContext.PlantingIntentions.Add(intention);
            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Created planting intention {Id} for customer {CustomerId}", intention.Id, customerId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating planting intention for customer {CustomerId}", customerId);
            throw;
        }
    }

    public async Task<PlantingIntention?> UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear)
    {
        try
        {
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId);
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
            intention.ModifiedOn = DateTime.UtcNow;

            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Updated planting intention {Id}", intentionId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating planting intention {Id}", intentionId);
            throw;
        }
    }

    public async Task DeletePlantingIntention(int intentionId)
    {
        try
        {
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId);
            if (intention != null)
            {
                _appContext.PlantingIntentions.Remove(intention);
                await _appContext.SaveChangesAsync();
                _logger.LogInformation("Deleted planting intention {Id}", intentionId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting planting intention {Id}", intentionId);
            throw;
        }
    }

    // =========================================================================
    // Note Operations - Uses dbo.Notes table in Origination database
    // =========================================================================

    public async Task<List<Note>> GetNotes()
    {
        try
        {
            _logger.LogInformation("Attempting to retrieve notes from database");

            return await _appContext.Notes
                .AsNoTracking()
                .OrderByDescending(n => n.CreatedOn)
                .ToListAsync();
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible (likely permissions issue). Returning empty list. Error: {Error}", ex.Message);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes");
            throw;
        }
    }

    public async Task<List<Note>> GetNotesByCustomer(long customerId)
    {
        try
        {
            return await _appContext.Notes
                .AsNoTracking()
                .Where(n => n.CustomerId == customerId)
                .OrderByDescending(n => n.CreatedOn)
                .ToListAsync();
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes for customer {CustomerId}", customerId);
            throw;
        }
    }

    public async Task<Note> AddNote(long customerId, string content, string? tradeUnit = null)
    {
        try
        {
            // Get customer info for denormalized fields
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId);
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
                CreatedOn = DateTime.UtcNow
            };

            _appContext.Notes.Add(note);
            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating note for customer {CustomerId}", customerId);
            throw;
        }
    }

    public async Task<Note?> ToggleNotePin(long noteId)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId);
            if (note == null)
            {
                return null;
            }

            note.IsPinned = !note.IsPinned;
            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error toggling pin for note {NoteId}", noteId);
            throw;
        }
    }

    public async Task<Note?> UpdateNote(long noteId, string content)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId);
            if (note == null)
            {
                return null;
            }

            note.Description = content;
            note.ModifiedBy = GetCurrentUser();
            note.ModifiedOn = DateTime.UtcNow;
            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Updated note {NoteId}", noteId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating note {NoteId}", noteId);
            throw;
        }
    }

    public async Task DeleteNote(long noteId)
    {
        try
        {
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId);
            if (note == null)
            {
                return;
            }

            _appContext.Notes.Remove(note);
            await _appContext.SaveChangesAsync();

            _logger.LogInformation("Deleted note {NoteId}", noteId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting note {NoteId}", noteId);
            throw;
        }
    }

    // =========================================================================
    // Producer Details Operations - Uses dbo.ProducerDetails table in Origination database
    // =========================================================================

    public async Task<ProducerDetails?> GetProducerDetails(long customerId)
    {
        try
        {
            return await _appContext.ProducerDetails.AsNoTracking().FirstOrDefaultAsync(pd => pd.CustomerId == customerId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible for customer {CustomerId}. Error: {Error}", customerId, ex.Message);
            return null;
        }
    }

    public async Task<List<ProducerDetails>> GetAllProducerDetails()
    {
        try
        {
            return await _appContext.ProducerDetails.AsNoTracking().ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<ProducerDetails>();
        }
    }

    public async Task<ProducerDetails> UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId);

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
                existing.ModifiedOn = DateTime.UtcNow;

                await _appContext.SaveChangesAsync();
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
                    CreatedOn = DateTime.UtcNow
                };

                _appContext.ProducerDetails.Add(details);
                await _appContext.SaveChangesAsync();
                _logger.LogInformation("Created ProducerDetails for customer {CustomerId}", customerId);
                return details;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error upserting ProducerDetails for customer {CustomerId}", customerId);
            throw;
        }
    }

    public async Task DeleteProducerDetails(long customerId)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId);
            if (existing != null)
            {
                _appContext.ProducerDetails.Remove(existing);
                await _appContext.SaveChangesAsync();
                _logger.LogInformation("Deleted ProducerDetails for customer {CustomerId}", customerId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting ProducerDetails for customer {CustomerId}", customerId);
            throw;
        }
    }

    // =========================================================================
    // Storage Operations - DISABLED: Table doesn't exist in ODS
    // =========================================================================

    public Task<List<StoredGrain>> GetStoredGrain()
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<StoredGrain>());
    }

    public Task<List<StoredGrain>> GetStoredGrainByCustomer(long customerId)
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<StoredGrain>());
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public async Task<List<SavedList>> GetSavedLists()
    {
        try
        {
            return await _appContext.SavedLists
                .AsNoTracking()
                .Where(s => s.IsActive)
                .OrderByDescending(s => s.CreatedOn)
                .ToListAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving saved lists");
            return new List<SavedList>();
        }
    }

    public async Task<SavedList> SaveList(string name, string query, string? tradeUnits, string? filters = null)
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
                CreatedOn = DateTime.UtcNow
            };
            _appContext.SavedLists.Add(savedList);
            await _appContext.SaveChangesAsync();
            return savedList;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving list");
            throw;
        }
    }

    public async Task<SavedList?> UpdateList(int listId, string name, string query, string? tradeUnits, string? filters = null)
    {
        try
        {
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId);
            if (list == null) return null;
            list.Name = name;
            list.Query = query;
            list.TradeUnits = tradeUnits;
            list.Filters = filters;
            await _appContext.SaveChangesAsync();
            return list;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating saved list {ListId}", listId);
            throw;
        }
    }

    public async Task DeleteList(int listId)
    {
        try
        {
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId);
            if (list == null) return;
            _appContext.SavedLists.Remove(list);
            await _appContext.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting saved list {ListId}", listId);
            throw;
        }
    }

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    public async Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear)
    {
        return await _appContext.DashboardPlantingEstimates
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToListAsync();
    }

    public async Task UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username)
    {
        foreach (var req in estimates)
        {
            var existing = await _appContext.DashboardPlantingEstimates
                .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                  && e.Crop == req.Crop
                                  && e.PlantingYear == req.PlantingYear);
            if (req.YieldEstimate == null)
            {
                if (existing != null)
                    _appContext.DashboardPlantingEstimates.Remove(existing);
            }
            else if (existing != null)
            {
                existing.YieldEstimate = req.YieldEstimate;
                existing.ModifiedOn = DateTime.UtcNow;
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
                    CreatedOn = DateTime.UtcNow,
                    CreatedBy = username
                });
            }
        }
        await _appContext.SaveChangesAsync();
    }

    public async Task<List<DashboardMarketShare>> GetDashboardMarketShares(string tradeUnitKey, int plantingYear)
    {
        return await _appContext.DashboardMarketShares
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync();
    }

    public async Task UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username)
    {
        foreach (var req in shares)
        {
            var existing = await _appContext.DashboardMarketShares
                .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                  && e.CropCategory == req.CropCategory
                                  && e.PlantingYear == req.PlantingYear);
            if (req.MarketSharePct == null)
            {
                if (existing != null)
                    _appContext.DashboardMarketShares.Remove(existing);
            }
            else if (existing != null)
            {
                existing.MarketSharePct = req.MarketSharePct;
                existing.ModifiedOn = DateTime.UtcNow;
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
                    CreatedOn = DateTime.UtcNow,
                    CreatedBy = username
                });
            }
        }
        await _appContext.SaveChangesAsync();
    }

    // Dashboard Actual Harvest Operations
    public async Task<List<DashboardActualHarvest>> GetDashboardActualHarvest(string tradeUnitKey, int plantingYear)
    {
        return await _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync();
    }

    public async Task UpsertDashboardActualHarvest(List<UpsertDashboardActualHarvestRequest> items, string username)
    {
        foreach (var req in items)
        {
            var existing = await _appContext.DashboardActualHarvests
                .FirstOrDefaultAsync(e => e.TradeUnitKey == req.TradeUnitKey
                                  && e.CropCategory == req.CropCategory
                                  && e.PlantingYear == req.PlantingYear);
            if (existing != null)
            {
                existing.Bushels = req.Bushels;
                existing.ModifiedOn = DateTime.UtcNow;
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
                    CreatedOn = DateTime.UtcNow,
                    CreatedBy = username
                });
            }
        }
        await _appContext.SaveChangesAsync();
    }

    public async Task DeleteDashboardActualHarvest(int id)
    {
        var entity = await _appContext.DashboardActualHarvests.FindAsync(id);
        if (entity != null)
        {
            _appContext.DashboardActualHarvests.Remove(entity);
            await _appContext.SaveChangesAsync();
        }
    }
}
