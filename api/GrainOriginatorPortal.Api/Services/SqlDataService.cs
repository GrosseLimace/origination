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
            // Query vw_CurrentCustomers view through Entity Framework
            // The view is mapped in OriginationDbContext and filters for IsCurrent = 1
            return _context.Customers
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
            return _context.Contracts
                .OrderByDescending(c => c.Id)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts");
            throw;
        }
    }

    public List<Contract> GetContractsByCustomer(long customerId)
    {
        try
        {
            return _context.Contracts
                .Where(c => c.CustomerId == customerId)
                .OrderByDescending(c => c.Id)
                .ToList();
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
    // Ticket Operations - DISABLED: vw_CurrentTickets doesn't exist in ODS yet
    // =========================================================================

    public List<Ticket> GetTickets()
    {
        _logger.LogWarning("Tickets view doesn't exist in ODS yet - returning empty list");
        return new List<Ticket>();
    }

    public List<Ticket> GetTicketsByCustomer(long customerId)
    {
        _logger.LogWarning("Tickets view doesn't exist in ODS yet - returning empty list");
        return new List<Ticket>();
    }

    public List<Ticket> GetTicketsByFarm(string farmId)
    {
        _logger.LogWarning("Tickets view doesn't exist in ODS yet - returning empty list");
        return new List<Ticket>();
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
