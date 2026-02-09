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
            // Get distinct CtrmCustomerId from the top 1000 most recent contracts
            var contractCustomerIds = _context.Contracts
                .OrderByDescending(c => c.Id)
                .Take(1000)
                .Select(c => c.CtrmCustomerId)
                .Distinct();

            // Get customers where SourceCustomerId matches CtrmCustomerId from contracts
            // Exclude customers with names containing DUP or DO NOT USE
            // Exclude customers with names starting with * or $
            return _context.Customers
                .Join(contractCustomerIds,
                      customer => customer.SourceCustomerId,
                      ctrmCustomerId => ctrmCustomerId,
                      (customer, ctrmCustomerId) => customer)
                .Where(c => !c.Name.Contains("DUP") &&
                           !c.Name.Contains("DO NOT USE") &&
                           !c.Name.StartsWith("*") &&
                           !c.Name.StartsWith("$"))
                .OrderBy(c => c.Name)
                .ToList();
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
                .FirstOrDefault(c => c.Id == id);
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
            var customer = _context.Customers.FirstOrDefault(c => c.Id == customerId);
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
            // Get top 1000 most recent contracts
            // Limited to avoid timeout on large dataset
            var contracts = _context.Contracts
                .OrderByDescending(c => c.Id)
                .Take(1000)
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
                .Where(c => c.CustomerId == customerId)
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
            // WARNING: Limit to recent tickets only - full table scan would timeout
            // Get top 10,000 most recent tickets
            _logger.LogInformation("Loading top 10,000 most recent tickets from ODS");

            return _context.Tickets
                .OrderByDescending(t => t.Date)
                .Take(10000)
                .ToList();
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
            // Load tickets for specific customer, limited to last 2 years for performance
            var twoYearsAgo = DateTime.Today.AddYears(-2);

            return _context.Tickets
                .Where(t => t.CustomerId == customerId && t.Date >= twoYearsAgo)
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
