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

            // Get top 50 customers who have BOTH contracts AND tickets
            // Exclude customers with names containing DUP or DO NOT USE
            // Exclude customers with names starting with * or $
            var customers = _context.Customers
                .Where(c => c.IsActive &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id) // Most recent customers by ID
                .Take(50) // Limit to 50 customers
                .ToList();

            _logger.LogInformation($"Returning {customers.Count} customers who have both contracts and tickets");
            return customers;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers");
            throw;
        }
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

            // Get SourceCustomerIds for top 50 customers who have BOTH contracts AND tickets
            var customerCtrmIds = _context.Customers
                .Where(c => c.IsActive &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id)
                .Take(50)
                .Select(c => c.SourceCustomerId)
                .ToList();

            // Get all contracts for those top 50 customers
            var contracts = _context.Contracts
                .Where(c => c.IsActive && c.CtrmCustomerId != null && customerCtrmIds.Contains(c.CtrmCustomerId))
                .OrderByDescending(c => c.Id)
                .ToList();

            _logger.LogInformation($"Loaded {contracts.Count} contracts for top 50 customers who have both contracts and tickets");

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
            var contracts = _context.Contracts
                .Where(c => c.IsActive && c.CustomerId == customerId)
                .OrderByDescending(c => c.Id)
                .ToList();

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

            // Get customer IDs that have tickets (via CustomerId)
            var customerIdsWithTickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerId.HasValue)
                .Select(t => t.CustomerId!.Value)
                .Distinct()
                .ToList();

            // Get top 50 customer IDs who have BOTH contracts AND tickets
            var top50CustomerIds = _context.Customers
                .Where(c => c.IsActive &&
                           customerIdsWithContracts.Contains(c.SourceCustomerId) &&
                           customerIdsWithTickets.Contains(c.Id) &&
                           !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderByDescending(c => c.Id)
                .Take(50)
                .Select(c => c.Id)
                .ToList();

            _logger.LogInformation("Loading tickets for top 50 customers who have both contracts and tickets");

            // Load all tickets for the top 50 customers
            // NOTE: ContractId FK is NOW POPULATED in base.Ticket table (proper FK relationship)
            // Can use proper FK joins instead of string matching
            var tickets = _context.Tickets
                .Where(t => t.IsActive && t.CustomerId.HasValue && top50CustomerIds.Contains(t.CustomerId.Value))
                .OrderByDescending(t => t.Date)
                .ToList();

            // Log diagnostic info about ticket-contract relationships
            var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
            var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
            var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

            _logger.LogInformation($"Loaded {tickets.Count} tickets for top 50 customers and their contracts");
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
            // Load tickets for specific customer
            // Note: Date is stored as string in ODS, so we can't filter by date range efficiently
            return _context.Tickets
                .Where(t => t.IsActive && t.CustomerId == customerId)
                .OrderByDescending(t => t.Date)
                .ToList();
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
