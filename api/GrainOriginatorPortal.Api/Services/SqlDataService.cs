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

    public SqlDataService(OriginationDbContext context, ApplicationDbContext appContext, ILogger<SqlDataService> logger)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public List<Customer> GetCustomers(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Build ticket query with optional organization code filter
            var ticketQuery = _context.Tickets.Where(t => t.IsActive && t.CustomerId.HasValue);
            if (hasTradeUnitFilter)
            {
                ticketQuery = ticketQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = ticketQuery
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToList();

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units: {string.Join(", ", tradeUnits)})" : "";
            _logger.LogInformation($"Found {customerIdsWithContracts.Count} customers with contracts, {customerIdsWithTickets.Count} customers with tickets{filterMsg}");

            // Get customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            // Exclude customers with names containing DUP or DO NOT USE
            // Exclude customers with names starting with * or $
            // When trade units are selected, show ALL customers; otherwise limit to 15
            var customerQuery = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderBy(c => c.Name); // Alphabetical order by name (A-Z)

            // Only limit to 15 when no trade units are selected
            var customers = hasTradeUnitFilter
                ? customerQuery.ToList()
                : customerQuery.Take(15).ToList();

            _logger.LogInformation($"Returning {customers.Count} producer customers who have both contracts and tickets{filterMsg}");
            return customers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers");
            throw;
        }
    }

    public List<Customer> SearchCustomers(string searchTerm, List<string>? tradeUnits = null)
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
                customerIdsWithTradeUnitContracts = _context.Contracts
                    .Where(c => c.IsActive && c.CtrmCustomerId != null && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToList();

                customerIdsWithTradeUnitTickets = _context.Tickets
                    .Where(t => t.IsActive && t.CustomerId.HasValue && t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode))
                    .Select(t => t.CustomerId!.Value)
                    .Distinct()
                    .ToList();
            }

            // Start with base query filtering by producer customers
            var query = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"));

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
            var candidates = query
                .Take(hasTradeUnitFilter ? 1000 : 100)
                .ToList();

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

            _logger.LogInformation($"Search for '{searchTerm}' returned {scoredCustomers.Count} producer customers (ranked by relevance)");
            return scoredCustomers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching customers for term: {SearchTerm}", searchTerm);
            throw;
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

    public Customer? GetCustomerById(long id)
    {
        try
        {
            return _context.Customers
                .FirstOrDefault(c => c.Id == id && c.IsActive);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer {CustomerId}", id);
            throw;
        }
    }

    public void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds)
    {
        try
        {
            var customer = _context.Customers.FirstOrDefault(c => c.Id == customerId && c.IsActive);
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

            _context.SaveChanges();
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

    public List<string> GetTradeUnits()
    {
        try
        {
            var cachedTradeUnits = _appContext.TradeUnits
                .Where(tu => tu.IsActive)
                .Select(tu => tu.Code)
                .OrderBy(c => c)
                .ToList();

            if (cachedTradeUnits.Count > 0)
            {
                _logger.LogInformation("Returning {Count} trade units from dbo.TradeUnits", cachedTradeUnits.Count);
                return cachedTradeUnits;
            }

            // Table is empty - one-time population from ODS
            _logger.LogInformation("dbo.TradeUnits is empty - performing one-time population from ODS");
            var tradeUnitsFromOds = GetTradeUnitsFromViews();

            foreach (var code in tradeUnitsFromOds)
            {
                _appContext.TradeUnits.Add(new TradeUnit { Code = code, IsActive = true });
            }
            _appContext.SaveChanges();
            return tradeUnitsFromOds;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade units");
            throw;
        }
    }

    private List<string> GetTradeUnitsFromViews()
    {
        // Get unique trade units from contracts
        var contractTradeUnits = _context.Contracts
            .Where(c => c.IsActive && !string.IsNullOrEmpty(c.TradeUnit))
            .Select(c => c.TradeUnit!)
            .Distinct()
            .ToList();

        // Get unique organization codes from tickets
        var ticketOrgCodes = _context.Tickets
            .Where(t => t.IsActive && !string.IsNullOrEmpty(t.OrganizationCode))
            .Select(t => t.OrganizationCode!)
            .Distinct()
            .ToList();

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

    public List<Commodity> GetCommodities()
    {
        try
        {
            var existingCodes = new HashSet<string>(
                _appContext.Commodities.Where(c => c.IsActive).Select(c => c.Code),
                StringComparer.OrdinalIgnoreCase
            );

            // Pull all commodity data from contracts (Code, Name, Category)
            var contractCommodities = _context.Contracts
                .Where(c => c.IsActive
                    && !string.IsNullOrEmpty(c.CommodityCode)
                    && !string.IsNullOrEmpty(c.CommodityDescription))
                .Select(c => new { c.CommodityCode, c.CommodityDescription, c.CommodityGroup })
                .Distinct()
                .ToList();

            // Pull all distinct product codes from tickets
            var ticketProductCodes = _context.Tickets
                .Where(t => t.IsActive && !string.IsNullOrEmpty(t.ProductCode))
                .Select(t => t.ProductCode!)
                .Distinct()
                .ToList();

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
            var allCommodities = _appContext.Commodities.Where(c => c.IsActive).ToList();
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
                _appContext.SaveChanges();
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

    public List<TradeUnitGroup> GetTradeUnitGroups()
    {
        try
        {
            var groups = _appContext.TradeUnitGroups
                .Where(g => g.IsActive)
                .Include(g => g.TradeUnits.Where(tu => tu.IsActive))
                .OrderBy(g => g.GroupName)
                .ToList();

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

    public List<Farm> GetFarms()
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list");
        return new List<Farm>();
    }

    public List<Farm> GetFarmsByCustomer(long customerId)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return new List<Farm>();
    }

    public Farm? GetFarmById(string id)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning null for farm {FarmId}", id);
        return null;
    }

    public string CreateFarm(string name, string location, int acres)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - cannot create farm {FarmName}", name);
        throw new NotImplementedException("Farm creation is not supported - Farms table doesn't exist in ODS");
    }

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public List<Contract> GetContracts(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Build ticket query with optional organization code filter
            var ticketQuery = _context.Tickets.Where(t => t.IsActive && t.CustomerId.HasValue);
            if (hasTradeUnitFilter)
            {
                ticketQuery = ticketQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = ticketQuery
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToList();

            // Get SourceCustomerIds for customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            // When trade units are selected, get ALL customers; otherwise limit to 15
            var customerQuery = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderBy(c => c.Name); // Alphabetical order by name (A-Z)

            var customerCtrmIds = hasTradeUnitFilter
                ? customerQuery.Select(c => c.SourceCustomerId).ToList()
                : customerQuery.Take(15).Select(c => c.SourceCustomerId).ToList();

            // Get all contracts for those customers
            var contractsQuery = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId));

            // Apply trade unit filter if specified
            if (hasTradeUnitFilter)
            {
                contractsQuery = contractsQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            var contracts = contractsQuery
                .OrderByDescending(c => c.Id)
                .ToList();

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            _logger.LogInformation($"Loaded {contracts.Count} contracts for customers who have both contracts and tickets{filterMsg}");

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

    public List<Contract> GetContractsByCustomer(long customerId)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with contract.CtrmCustomerId
            var customer = _context.Customers.FirstOrDefault(c => c.Id == customerId && c.IsActive);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                return new List<Contract>();
            }

            // Match contracts using CtrmCustomerId = customer.SourceCustomerId (string matching)
            var contracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId == customer.SourceCustomerId)
                .OrderByDescending(c => c.Id)
                .ToList();

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
            _logger.LogError(ex, "Error retrieving contracts for customer {CustomerId}", customerId);
            throw;
        }
    }

    public List<Contract> GetContractsByFarm(string farmId)
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
            _logger.LogError(ex, "Error retrieving contracts for farm {FarmId}", farmId);
            throw;
        }
    }

    public List<ContractPricingLine> GetPricingLines(string sourceContractId)
    {
        try
        {
            return _context.ContractPricingLines
                .Where(p => p.ContractId == sourceContractId)
                .OrderBy(p => p.PriceSequence)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving pricing lines for contract {ContractId}", sourceContractId);
            throw;
        }
    }

    public List<ContractPricingLine> GetPricingLinesByCustomer(string sourceCustomerId)
    {
        try
        {
            return _context.ContractPricingLines
                .Where(p => p.CustomerId == sourceCustomerId)
                .OrderBy(p => p.ContractId)
                .ThenBy(p => p.PriceSequence)
                .ToList();
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

    public List<Ticket> GetTickets(List<string>? tradeUnits = null)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Build contract query with optional trade unit filter
            var contractQuery = _context.Contracts.Where(c => c.IsActive && c.CtrmCustomerId != null);
            if (hasTradeUnitFilter)
            {
                contractQuery = contractQuery.Where(c => c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit));
            }

            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = contractQuery
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Build ticket query with optional organization code filter
            var ticketQueryBase = _context.Tickets.Where(t => t.IsActive && t.CustomerCode != null);
            if (hasTradeUnitFilter)
            {
                ticketQueryBase = ticketQueryBase.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            // Get customer codes that have tickets (via CustomerCode)
            var customerCodesWithTickets = ticketQueryBase
                .Select(t => t.CustomerCode!)
                .Distinct()
                .ToList();

            // Get producer customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            // Get their SourceCustomerIds for matching with tickets
            // When trade units are selected, get ALL customers; otherwise limit to 15
            var customerQuery = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           c.SourceCustomerId != null &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerCodesWithTickets.Contains(c.SourceCustomerId) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderBy(c => c.Name); // Alphabetical order by name (A-Z)

            var producerCustomerCodes = hasTradeUnitFilter
                ? customerQuery.Select(c => c.SourceCustomerId!).ToList()
                : customerQuery.Take(15).Select(c => c.SourceCustomerId!).ToList();

            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units)" : "";
            var customerCountMsg = hasTradeUnitFilter ? $"all {producerCustomerCodes.Count} customers" : "top 15 customers";
            _logger.LogInformation($"Loading tickets for {customerCountMsg} who have both contracts and tickets{filterMsg}");

            // Load all tickets for those producer customers using string matching (CustomerCode = SourceCustomerId)
            var ticketsQuery = _context.Tickets
                .Where(t => t.IsActive && t.CustomerCode != null && producerCustomerCodes.Contains(t.CustomerCode));

            // Apply trade unit filter if specified
            if (hasTradeUnitFilter)
            {
                ticketsQuery = ticketsQuery.Where(t => t.OrganizationCode != null && tradeUnits!.Contains(t.OrganizationCode));
            }

            var tickets = ticketsQuery
                .OrderByDescending(t => t.Date)
                .ToList();

            // Load quality data for these tickets
            var ticketIds = tickets.Select(t => t.Id).ToList();
            var qualityData = _context.TicketQualities
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToDictionary(q => q.TicketId);

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

            _logger.LogInformation($"Loaded {tickets.Count} tickets for top 25 customers who have both contracts and tickets");
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
            _logger.LogError(ex, "Error retrieving tickets");
            return new List<Ticket>(); // Return empty on error rather than failing
        }
    }

    public List<Ticket> GetTicketsByCustomer(long customerId)
    {
        try
        {
            // Get the customer's SourceCustomerId for matching with ticket.CustomerCode
            var customer = _context.Customers.FirstOrDefault(c => c.Id == customerId && c.IsActive);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                return new List<Ticket>();
            }

            // Match tickets using CustomerCode = customer.SourceCustomerId (string matching, like contracts)
            var tickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerCode == customer.SourceCustomerId)
                .OrderByDescending(t => t.Date)
                .ToList();

            // Load quality data for these tickets
            var ticketIds = tickets.Select(t => t.Id).ToList();
            var qualityData = _context.TicketQualities
                .Where(q => ticketIds.Contains(q.TicketId))
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

            _logger.LogInformation($"Found {tickets.Count} tickets for customer {customerId} (SourceCustomerId: {customer.SourceCustomerId})");
            return tickets;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for customer {CustomerId}", customerId);
            return new List<Ticket>(); // Return empty on error
        }
    }

    public List<Ticket> GetTicketsByFarm(string farmId)
    {
        try
        {
            // Note: FarmId is not in ODS tickets view - cannot filter by farm
            _logger.LogWarning("Ticket.FarmId is not mapped in ODS - returning empty list for farm {FarmId}", farmId);
            return new List<Ticket>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for farm {FarmId}", farmId);
            return new List<Ticket>();
        }
    }

    // =========================================================================
    // Planting Intention Operations - Uses dbo.ProducerPlantingIntentions table
    // =========================================================================

    public List<PlantingIntention> GetPlantingIntentions()
    {
        try
        {
            return _appContext.PlantingIntentions
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.CustomerName)
                .ToList();
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

    public List<PlantingIntention> GetPlantingIntentionsByCustomer(int customerId)
    {
        try
        {
            return _appContext.PlantingIntentions
                .Where(p => p.CustomerId == customerId)
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Crop)
                .ToList();
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

    public PlantingIntention AddPlantingIntention(int customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear)
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
                CreatedBy = "System", // TODO: Get from authenticated user
                CreatedOn = DateTime.Now
            };

            _appContext.PlantingIntentions.Add(intention);
            _appContext.SaveChanges();

            _logger.LogInformation("Created planting intention {Id} for customer {CustomerId}", intention.Id, customerId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating planting intention for customer {CustomerId}", customerId);
            throw;
        }
    }

    public PlantingIntention? UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear)
    {
        try
        {
            var intention = _appContext.PlantingIntentions.FirstOrDefault(p => p.Id == intentionId);
            if (intention == null)
            {
                return null;
            }

            intention.Crop = crop;
            intention.Type = type;
            intention.Description = description;
            intention.Acres = acres;
            intention.PlantingYear = plantingYear;
            intention.ModifiedBy = "System"; // TODO: Get from authenticated user
            intention.ModifiedOn = DateTime.Now;

            _appContext.SaveChanges();

            _logger.LogInformation("Updated planting intention {Id}", intentionId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating planting intention {Id}", intentionId);
            throw;
        }
    }

    public void DeletePlantingIntention(int intentionId)
    {
        try
        {
            var intention = _appContext.PlantingIntentions.FirstOrDefault(p => p.Id == intentionId);
            if (intention != null)
            {
                _appContext.PlantingIntentions.Remove(intention);
                _appContext.SaveChanges();
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

    public List<Note> GetNotes()
    {
        try
        {
            _logger.LogInformation("Attempting to retrieve notes from database");

            return _appContext.Notes
                .OrderByDescending(n => n.CreatedOn)
                .ToList();
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

    public List<Note> GetNotesByCustomer(long customerId)
    {
        try
        {
            return _appContext.Notes
                .Where(n => n.CustomerId == customerId)
                .OrderByDescending(n => n.CreatedOn)
                .ToList();
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

    public Note AddNote(long customerId, string content, string? tradeUnit = null)
    {
        try
        {
            // Get customer info for denormalized fields
            var customer = _context.Customers.FirstOrDefault(c => c.Id == customerId);
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
                CreatedBy = "System", // TODO: Get from authenticated user
                CreatedOn = DateTime.UtcNow
            };

            _appContext.Notes.Add(note);
            _appContext.SaveChanges();

            _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating note for customer {CustomerId}", customerId);
            throw;
        }
    }

    public Note? ToggleNotePin(long noteId)
    {
        try
        {
            var note = _appContext.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null)
            {
                return null;
            }

            note.IsPinned = !note.IsPinned;
            _appContext.SaveChanges();

            _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error toggling pin for note {NoteId}", noteId);
            throw;
        }
    }

    public Note? UpdateNote(long noteId, string content)
    {
        try
        {
            var note = _appContext.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null)
            {
                return null;
            }

            note.Description = content;
            note.ModifiedBy = "System"; // TODO: Get from authenticated user
            note.ModifiedOn = DateTime.UtcNow;
            _appContext.SaveChanges();

            _logger.LogInformation("Updated note {NoteId}", noteId);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating note {NoteId}", noteId);
            throw;
        }
    }

    public void DeleteNote(long noteId)
    {
        try
        {
            var note = _appContext.Notes.FirstOrDefault(n => n.Id == noteId);
            if (note == null)
            {
                return;
            }

            _appContext.Notes.Remove(note);
            _appContext.SaveChanges();

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

    public ProducerDetails? GetProducerDetails(long customerId)
    {
        try
        {
            return _appContext.ProducerDetails.FirstOrDefault(pd => pd.CustomerId == customerId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible for customer {CustomerId}. Error: {Error}", customerId, ex.Message);
            return null;
        }
    }

    public List<ProducerDetails> GetAllProducerDetails()
    {
        try
        {
            return _appContext.ProducerDetails.ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<ProducerDetails>();
        }
    }

    public ProducerDetails UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null)
    {
        try
        {
            var existing = _appContext.ProducerDetails.FirstOrDefault(pd => pd.CustomerId == customerId);

            if (existing != null)
            {
                existing.SourceCustomerId = sourceCustomerId;
                existing.CustomerName = customerName;
                existing.TotalAcres = totalAcres;
                existing.BinCapacity = binCapacity;
                existing.PrimaryContact = primaryContact;
                existing.Commodities = commodities;
                existing.LinkedProducerIds = linkedProducerIds;
                existing.ModifiedBy = "system";
                existing.ModifiedOn = DateTime.UtcNow;

                _appContext.SaveChanges();
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
                    CreatedBy = "system",
                    CreatedOn = DateTime.UtcNow
                };

                _appContext.ProducerDetails.Add(details);
                _appContext.SaveChanges();
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

    public void DeleteProducerDetails(long customerId)
    {
        try
        {
            var existing = _appContext.ProducerDetails.FirstOrDefault(pd => pd.CustomerId == customerId);
            if (existing != null)
            {
                _appContext.ProducerDetails.Remove(existing);
                _appContext.SaveChanges();
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

    public List<StoredGrain> GetStoredGrain()
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return new List<StoredGrain>();
    }

    public List<StoredGrain> GetStoredGrainByCustomer(long customerId)
    {
        _logger.LogWarning("StoredGrain table doesn't exist in ODS - returning empty list");
        return new List<StoredGrain>();
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public List<SavedList> GetSavedLists()
    {
        try
        {
            return _appContext.SavedLists
                .Where(s => s.IsActive)
                .OrderByDescending(s => s.CreatedOn)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving saved lists");
            return new List<SavedList>();
        }
    }

    public SavedList SaveList(string name, string query, string? tradeUnits)
    {
        try
        {
            var savedList = new SavedList
            {
                Name = name,
                Query = query,
                TradeUnits = tradeUnits,
                CreatedBy = "System",
                CreatedOn = DateTime.UtcNow
            };
            _appContext.SavedLists.Add(savedList);
            _appContext.SaveChanges();
            return savedList;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving list");
            throw;
        }
    }

    public void DeleteList(int listId)
    {
        try
        {
            var list = _appContext.SavedLists.FirstOrDefault(s => s.Id == listId);
            if (list == null) return;
            _appContext.SavedLists.Remove(list);
            _appContext.SaveChanges();
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

    public List<DashboardPlantingEstimate> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear)
    {
        return _appContext.DashboardPlantingEstimates
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToList();
    }

    public void UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username)
    {
        foreach (var req in estimates)
        {
            var existing = _appContext.DashboardPlantingEstimates
                .FirstOrDefault(e => e.TradeUnitKey == req.TradeUnitKey
                                  && e.Crop == req.Crop
                                  && e.PlantingYear == req.PlantingYear);
            if (existing != null)
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
        _appContext.SaveChanges();
    }

    public List<DashboardMarketShare> GetDashboardMarketShares(string tradeUnitKey, int plantingYear)
    {
        return _appContext.DashboardMarketShares
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToList();
    }

    public void UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username)
    {
        foreach (var req in shares)
        {
            var existing = _appContext.DashboardMarketShares
                .FirstOrDefault(e => e.TradeUnitKey == req.TradeUnitKey
                                  && e.CropCategory == req.CropCategory
                                  && e.PlantingYear == req.PlantingYear);
            if (existing != null)
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
        _appContext.SaveChanges();
    }
}
