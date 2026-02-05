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

    public void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds)
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
    // Ticket Operations
    // =========================================================================

    public List<Ticket> GetTickets()
    {
        try
        {
            return _context.Tickets
                .OrderByDescending(t => t.Date)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets");
            throw;
        }
    }

    public List<Ticket> GetTicketsByCustomer(long customerId)
    {
        try
        {
            return _context.Tickets
                .Where(t => t.CustomerId == customerId)
                .OrderByDescending(t => t.Date)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for customer {CustomerId}", customerId);
            throw;
        }
    }

    public List<Ticket> GetTicketsByFarm(string farmId)
    {
        try
        {
            return _context.Tickets
                .Where(t => t.FarmId == farmId)
                .OrderByDescending(t => t.Date)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for farm {FarmId}", farmId);
            throw;
        }
    }

    // =========================================================================
    // Planting Intention Operations - DISABLED: PlantingIntentions table doesn't exist in ODS
    // =========================================================================

    public List<PlantingIntention> GetPlantingIntentions()
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - returning empty list");
        return new List<PlantingIntention>();
    }

    public List<PlantingIntention> GetPlantingIntentionsByCustomer(long customerId)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return new List<PlantingIntention>();
    }

    public void AddPlantingIntention(long customerId, string farmId, string crop, int acres,
        string variety, DateTime plantingDate, int estimatedYield)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - cannot add planting intention");
        throw new NotImplementedException("Planting intention creation is not supported - PlantingIntentions table doesn't exist in ODS");
    }

    public void UpdatePlantingIntention(string intentionId, string crop, int acres,
        string variety, DateTime plantingDate, int estimatedYield)
    {
        _logger.LogWarning("PlantingIntentions table doesn't exist in ODS - cannot update planting intention {IntentionId}", intentionId);
        throw new NotImplementedException("Planting intention update is not supported - PlantingIntentions table doesn't exist in ODS");
    }

    // =========================================================================
    // Note Operations
    // =========================================================================

    public List<Note> GetNotes()
    {
        try
        {
            return /* Notes table disabled */ new List<Note>().AsQueryable()
                .OrderByDescending(n => n.IsPinned)
                .ThenByDescending(n => n.CreatedAt)
                .ToList();
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
            var customerIdString = customerId.ToString();
            return /* Notes table disabled */ new List<Note>().AsQueryable()
                .Where(n => n.CustomerId == customerIdString)
                .OrderByDescending(n => n.IsPinned)
                .ThenByDescending(n => n.CreatedAt)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes for customer {CustomerId}", customerId);
            throw;
        }
    }

    public Note AddNote(long customerId, string content)
    {
        try
        {
            var maxId = /* Notes table disabled */ new List<Note>().AsQueryable()
                .Select(n => n.Id)
                .AsEnumerable()
                .Select(id => int.TryParse(id.Replace("N", ""), out var num) ? num : 0)
                .DefaultIfEmpty(0)
                .Max();

            var newId = $"N{(maxId + 1).ToString().PadLeft(3, '0')}";

            var note = new Note
            {
                Id = newId,
                CustomerId = customerId.ToString(),
                CreatedBy = "Current User", // TODO: Get from authenticated user context
                CreatedAt = DateTime.UtcNow,
                Content = content,
                IsPinned = false
            };

            // /* Notes table disabled */ new List<Note>().AsQueryable().Add(note);
            // _context.SaveChanges();

            _logger.LogWarning("Notes table doesn't exist in ODS - cannot add note for customer {CustomerId}", customerId);
            throw new NotImplementedException("Note creation is not supported - Notes table doesn't exist in ODS");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error adding note for customer {CustomerId}", customerId);
            throw;
        }
    }

    public Note? ToggleNotePin(string noteId)
    {
        try
        {
            var note = /* Notes table disabled */ new List<Note>().AsQueryable().FirstOrDefault(n => n.Id == noteId);
            if (note == null)
            {
                _logger.LogWarning("Note {NoteId} not found for pin toggle", noteId);
                return null;
            }

            note.IsPinned = !note.IsPinned;
            _context.SaveChanges();

            _logger.LogInformation("Toggled pin for note {NoteId} to {IsPinned}", noteId, note.IsPinned);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error toggling pin for note {NoteId}", noteId);
            throw;
        }
    }

    // =========================================================================
    // Stored Grain Operations
    // =========================================================================

    public List<StoredGrain> GetStoredGrain()
    {
        try
        {
            return /* StoredGrains table disabled */ new List<StoredGrain>().AsQueryable()
                .OrderByDescending(s => s.StorageStartDate)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain");
            throw;
        }
    }

    public List<StoredGrain> GetStoredGrainByCustomer(long customerId)
    {
        try
        {
            var customerIdString = customerId.ToString();
            return /* StoredGrains table disabled */ new List<StoredGrain>().AsQueryable()
                .Where(s => s.CustomerId == customerIdString)
                .OrderByDescending(s => s.StorageStartDate)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain for customer {CustomerId}", customerId);
            throw;
        }
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public List<SavedList> GetSavedLists()
    {
        try
        {
            return /* SavedLists table disabled */ new List<SavedList>().AsQueryable()
                .OrderByDescending(l => l.CreatedAt)
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving saved lists");
            throw;
        }
    }

    public void SaveList(string name, string query, List<string> customerIds)
    {
        try
        {
            var maxId = /* SavedLists table disabled */ new List<SavedList>().AsQueryable()
                .Select(l => l.Id)
                .AsEnumerable()
                .Select(id => int.TryParse(id.Replace("L", ""), out var num) ? num : 0)
                .DefaultIfEmpty(0)
                .Max();

            var newId = $"L{(maxId + 1).ToString().PadLeft(3, '0')}";

            var list = new SavedList
            {
                Id = newId,
                Name = name,
                Query = query,
                CustomerIds = customerIds,
                CreatedAt = DateTime.UtcNow
            };

            // /* SavedLists table disabled */ new List<SavedList>().AsQueryable().Add(list);
            // _context.SaveChanges();

            _logger.LogWarning("SavedLists table doesn't exist in ODS - cannot save list {ListName}", name);
            throw new NotImplementedException("List saving is not supported - SavedLists table doesn't exist in ODS");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving list {ListName}", name);
            throw;
        }
    }

    public void DeleteList(string listId)
    {
        try
        {
            // var list = /* SavedLists table disabled */ new List<SavedList>().AsQueryable().FirstOrDefault(l => l.Id == listId);
            // if (list == null)
            // {
            //     _logger.LogWarning("Saved list {ListId} not found for deletion", listId);
            //     return;
            // }
            //
            // /* SavedLists table disabled */ new List<SavedList>().AsQueryable().Remove(list);
            // _context.SaveChanges();

            _logger.LogWarning("SavedLists table doesn't exist in ODS - cannot delete list {ListId}", listId);
            throw new NotImplementedException("List deletion is not supported - SavedLists table doesn't exist in ODS");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting saved list {ListId}", listId);
            throw;
        }
    }
}
