using Microsoft.EntityFrameworkCore;
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
    private readonly ILogger<SqlDataService> _logger;

    public SqlDataService(OriginationDbContext context, ILogger<SqlDataService> logger)
    {
        _context = context;
        _logger = logger;
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public List<Customer> GetCustomers()
    {
        try
        {
            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null)
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerId.HasValue)
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToList();

            _logger.LogInformation($"Found {customerIdsWithContracts.Count} customers with contracts, {customerIdsWithTickets.Count} customers with tickets");

            // Get top 15 customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            // Exclude customers with names containing DUP or DO NOT USE
            // Exclude customers with names starting with * or $
            var customers = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id) // Most recent customers by ID
                .Take(15) // Limit to 15 customers
                .ToList();

            _logger.LogInformation($"Returning {customers.Count} producer customers who have both contracts and tickets");
            return customers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers");
            throw;
        }
    }

    public List<Customer> SearchCustomers(string searchTerm)
    {
        try
        {
            // Split search term into words for flexible matching
            // Example: "Jim Johnson" will match "Johnson, Jim R" because both "Jim" and "Johnson" are in the name
            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();

            // Start with base query filtering by producer customers
            var query = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"));

            // Add Contains condition for each search word (all words must be present in name)
            foreach (var word in searchWords)
            {
                query = query.Where(c => c.Name.Contains(word));
            }

            // Get candidates (without ordering in SQL - we'll order by relevance in memory)
            var candidates = query
                .Take(100) // Get more candidates for relevance scoring
                .ToList();

            // Score each customer by relevance
            var scoredCustomers = candidates.Select(c => new
            {
                Customer = c,
                Score = CalculateRelevanceScore(c.Name, searchWords, searchTerm)
            })
            .OrderByDescending(x => x.Score) // Most relevant first
            .ThenBy(x => x.Customer.Name)     // Then alphabetically for ties
            .Take(15)                          // Top 15 results
            .Select(x => x.Customer)
            .ToList();

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

    public List<Contract> GetContracts()
    {
        try
        {
            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null)
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerId.HasValue)
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToList();

            // Get SourceCustomerIds for top 15 customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            var customerCtrmIds = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id)
                .Take(15)
                .Select(c => c.SourceCustomerId)
                .ToList();

            // Get all contracts for those top 15 customers
            var contracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId))
                .OrderByDescending(c => c.Id)
                .ToList();

            _logger.LogInformation($"Loaded {contracts.Count} contracts for top 15 customers who have both contracts and tickets");

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

    // =========================================================================
    // Ticket Operations - Loads from vw_CurrentTickets in ODS
    // NOTE: ~2 million tickets exist, so queries are carefully limited
    // =========================================================================

    public List<Ticket> GetTickets()
    {
        try
        {
            // Get customer IDs that have contracts (via CtrmCustomerId -> SourceCustomerId)
            var customerIdsWithContracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null)
                .Select(c => c.CtrmCustomerId)
                .Distinct()
                .ToList();

            // Get customer codes that have tickets (via CustomerCode)
            var customerCodesWithTickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerCode != null)
                .Select(t => t.CustomerCode!)
                .Distinct()
                .ToList();

            // Get top 15 producer customers who have BOTH contracts AND tickets
            // Filter by IndustryCode1 = 'PR' (producer customers only)
            // Get their SourceCustomerIds for matching with tickets
            var producerCustomerCodes = _context.Customers
                .Where(c => c.IsActive &&
                           c.IndustryCode1 == "PR" &&
                           c.SourceCustomerId != null &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerCodesWithTickets.Contains(c.SourceCustomerId) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id)
                .Take(15)
                .Select(c => c.SourceCustomerId!)
                .ToList();

            _logger.LogInformation("Loading tickets for top 15 customers who have both contracts and tickets");

            // Load all tickets for those producer customers using string matching (CustomerCode = SourceCustomerId)
            var tickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerCode != null && producerCustomerCodes.Contains(t.CustomerCode))
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
    // Planting Intention Operations - DISABLED: Table doesn't exist in ODS
    // =========================================================================

    public List<PlantingIntention> GetPlantingIntentions()
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - returning empty list");
        return new List<PlantingIntention>();
    }

    public List<PlantingIntention> GetPlantingIntentionsByCustomer(long customerId)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - returning empty list");
        return new List<PlantingIntention>();
    }

    public void AddPlantingIntention(long customerId, string farmId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - operation skipped");
    }

    public void UpdatePlantingIntention(string intentionId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - operation skipped");
    }

    // =========================================================================
    // Note Operations - DISABLED: Table doesn't exist in ODS
    // =========================================================================

    public List<Note> GetNotes()
    {
        _logger.LogWarning("Notes table doesn't exist in ODS - returning empty list");
        return new List<Note>();
    }

    public List<Note> GetNotesByCustomer(long customerId)
    {
        _logger.LogWarning("Notes table doesn't exist in ODS - returning empty list");
        return new List<Note>();
    }

    public Note AddNote(long customerId, string content)
    {
        _logger.LogWarning("Notes table doesn't exist in ODS - returning dummy note");
        return new Note
        {
            Id = Guid.NewGuid().ToString(),
            CustomerId = customerId.ToString(),
            Content = content,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = "System",
            IsPinned = false
        };
    }

    public Note? ToggleNotePin(string noteId)
    {
        _logger.LogWarning("Notes table doesn't exist in ODS - operation skipped");
        return null;
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
    // Saved List Operations - DISABLED: Table doesn't exist in ODS
    // =========================================================================

    public List<SavedList> GetSavedLists()
    {
        _logger.LogWarning("SavedLists table doesn't exist in ODS - returning empty list");
        return new List<SavedList>();
    }

    public void SaveList(string name, string query, List<string> customerIds)
    {
        _logger.LogWarning("SavedLists table doesn't exist in ODS - operation skipped");
    }

    public void DeleteList(string listId)
    {
        _logger.LogWarning("SavedLists table doesn't exist in ODS - operation skipped");
    }
}
