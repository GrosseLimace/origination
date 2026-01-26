using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Mock implementation of IDataService for development and demonstration purposes.
/// </summary>
public class MockDataService : IDataService
{
    private List<Customer> _customers = new();
    private List<Farm> _farms = new();
    private List<Contract> _contracts = new();
    private List<Ticket> _tickets = new();
    private List<PlantingIntention> _plantingIntentions = new();
    private List<Note> _notes = new();
    private List<StoredGrain> _storedGrain = new();
    private List<SavedList> _savedLists = new();

    public MockDataService()
    {
        InitializeMockData();
    }

    private void InitializeMockData()
    {
        // Initialize Farms
        _farms = new List<Farm>
        {
            new() { Id = "F001", Name = "Anderson Main Farm", Location = "Iowa County, IA", Acres = 600, BinStorageCapacity = 45000 },
            new() { Id = "F002", Name = "Anderson North Farm", Location = "Johnson County, IA", Acres = 600, BinStorageCapacity = 38000 },
            new() { Id = "F003", Name = "Mitchell Grain Co.", Location = "Champaign County, IL", Acres = 2400, BinStorageCapacity = 180000 },
            new() { Id = "F004", Name = "Johnson Acres", Location = "Lancaster County, NE", Acres = 800, BinStorageCapacity = 52000 },
            new() { Id = "F005", Name = "Chen Agriculture LLC", Location = "Story County, IA", Acres = 1600, BinStorageCapacity = 95000 },
            new() { Id = "F006", Name = "Brown Valley Farm", Location = "McLean County, IL", Acres = 950, BinStorageCapacity = 62000 }
        };

        // Initialize Customers
        _customers = new List<Customer>
        {
            new() { Id = "1", Name = "John Anderson", Farm = "Anderson Family Farms", Location = "Iowa County, IA", Phone = "(319) 555-0123", Email = "john@andersonfarms.com", TotalAcres = 1200, FarmIds = new List<string> { "F001", "F002" }, LinkedProducerIds = new List<string>(), ESignEnabled = true, Coordinates = new Coordinates { Lat = 43.073051, Lng = -91.531031 } },
            new() { Id = "2", Name = "Sarah Mitchell", Farm = "Mitchell Grain Co.", Location = "Champaign County, IL", Phone = "(217) 555-0456", Email = "sarah@mitchellgrain.com", TotalAcres = 2400, FarmIds = new List<string> { "F003" }, LinkedProducerIds = new List<string>(), ESignEnabled = true, Coordinates = new Coordinates { Lat = 40.116421, Lng = -88.243382 } },
            new() { Id = "3", Name = "Robert Johnson", Farm = "Johnson Acres", Location = "Lancaster County, NE", Phone = "(402) 555-0789", Email = "rob@johnsonacres.com", TotalAcres = 800, FarmIds = new List<string> { "F004" }, LinkedProducerIds = new List<string>(), ESignEnabled = false, Coordinates = new Coordinates { Lat = 40.689249, Lng = -97.392773 } },
            new() { Id = "4", Name = "Emily Chen", Farm = "Chen Agriculture LLC", Location = "Story County, IA", Phone = "(515) 555-0321", Email = "emily@chenagriculture.com", TotalAcres = 1600, FarmIds = new List<string> { "F005" }, LinkedProducerIds = new List<string>(), ESignEnabled = true, Coordinates = new Coordinates { Lat = 42.032974, Lng = -93.639345 } },
            new() { Id = "5", Name = "Michael Brown", Farm = "Brown Valley Farm", Location = "McLean County, IL", Phone = "(309) 555-0654", Email = "michael@brownvalley.com", TotalAcres = 950, FarmIds = new List<string> { "F006" }, LinkedProducerIds = new List<string>(), ESignEnabled = false, Coordinates = new Coordinates { Lat = 40.116421, Lng = -88.243382 } }
        };

        // Initialize Contracts
        _contracts = new List<Contract>
        {
            new() { Id = "C001", CustomerId = "1", FarmId = "F001", ContractNumber = "C001", Crop = "Corn", Quantity = 50000, Unit = "bushels", Price = 4.85m, DeliveryStart = new DateTime(2024, 10, 1), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C002", CustomerId = "1", FarmId = "F001", ContractNumber = "C002", Crop = "Soybeans", Quantity = 30000, Unit = "bushels", Price = 12.50m, DeliveryStart = new DateTime(2024, 9, 15), DeliveryEnd = new DateTime(2024, 11, 30), Status = ContractStatus.Active, Signed = false },
            new() { Id = "C005", CustomerId = "1", FarmId = "F002", ContractNumber = "C005", Crop = "Corn", Quantity = 40000, Unit = "bushels", Price = 4.90m, DeliveryStart = new DateTime(2024, 10, 15), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C003", CustomerId = "2", FarmId = "F003", ContractNumber = "C003", Crop = "Corn", Quantity = 80000, Unit = "bushels", Price = 4.90m, DeliveryStart = new DateTime(2024, 10, 1), DeliveryEnd = new DateTime(2025, 1, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C004", CustomerId = "2", FarmId = "F003", ContractNumber = "C004", Crop = "Wheat", Quantity = 20000, Unit = "bushels", Price = 6.25m, DeliveryStart = new DateTime(2024, 7, 1), DeliveryEnd = new DateTime(2024, 8, 31), Status = ContractStatus.Fulfilled, Signed = true },
            new() { Id = "C006", CustomerId = "3", FarmId = "F004", ContractNumber = "C006", Crop = "Corn", Quantity = 35000, Unit = "bushels", Price = 4.80m, DeliveryStart = new DateTime(2024, 11, 1), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Pending, Signed = false }
        };

        // Initialize Tickets with realistic weights for 30-80% delivery progress
        _tickets = new List<Ticket>
        {
            // Customer 1 - Corn contract C001 (50,000 bu target, ~45% delivered)
            new() { Id = "T001", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-001", Date = new DateTime(2024, 10, 15), Crop = "Corn", GrossWeight = 82000, TareWeight = 32000, NetWeight = 560000, Moisture = 15.5m, TestWeight = 56.2m },
            new() { Id = "T002", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-002", Date = new DateTime(2024, 10, 18), Crop = "Corn", GrossWeight = 81800, TareWeight = 32000, NetWeight = 504000, Moisture = 16.2m, TestWeight = 55.8m },
            new() { Id = "T005", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-005", Date = new DateTime(2024, 10, 25), Crop = "Corn", GrossWeight = 79000, TareWeight = 32000, NetWeight = 196000, Moisture = 15.1m, TestWeight = 56.5m },
            // Customer 1 - Soybeans contract C002 (30,000 bu target, ~35% delivered)
            new() { Id = "T003", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-003", Date = new DateTime(2024, 9, 22), Crop = "Soybeans", GrossWeight = 68000, TareWeight = 32000, NetWeight = 378000, Moisture = 13.1m, TestWeight = 58.4m },
            new() { Id = "T006", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-006", Date = new DateTime(2024, 10, 5), Crop = "Soybeans", GrossWeight = 65000, TareWeight = 32000, NetWeight = 252000, Moisture = 12.8m, TestWeight = 59.1m },
            // Customer 2 - Corn contract C003 (80,000 bu target, ~60% delivered)
            new() { Id = "T004", CustomerId = "2", FarmId = "F003", TicketNumber = "TKT-2024-004", Date = new DateTime(2024, 10, 20), Crop = "Corn", GrossWeight = 93200, TareWeight = 33000, NetWeight = 1344000, Moisture = 14.8m, TestWeight = 57.1m },
            new() { Id = "T007", CustomerId = "2", FarmId = "F003", TicketNumber = "TKT-2024-007", Date = new DateTime(2024, 10, 28), Crop = "Corn", GrossWeight = 91500, TareWeight = 33000, NetWeight = 1344000, Moisture = 14.5m, TestWeight = 57.3m }
        };

        // Initialize Planting Intentions
        _plantingIntentions = new List<PlantingIntention>
        {
            new() { Id = "P001", CustomerId = "1", FarmId = "F001", Crop = "Corn", Acres = 700, Variety = "Pioneer P1197", PlantingDate = new DateTime(2025, 4, 25), EstimatedYield = 180 },
            new() { Id = "P002", CustomerId = "1", FarmId = "F001", Crop = "Soybeans", Acres = 500, Variety = "Asgrow AG46X6", PlantingDate = new DateTime(2025, 5, 10), EstimatedYield = 55 },
            new() { Id = "P003", CustomerId = "2", FarmId = "F003", Crop = "Corn", Acres = 1400, Variety = "DeKalb DKC62-54", PlantingDate = new DateTime(2025, 4, 20), EstimatedYield = 190 },
            new() { Id = "P004", CustomerId = "2", FarmId = "F003", Crop = "Soybeans", Acres = 800, Variety = "Channel 4518R2X", PlantingDate = new DateTime(2025, 5, 5), EstimatedYield = 58 },
            new() { Id = "P005", CustomerId = "2", FarmId = "F003", Crop = "Wheat", Acres = 200, Variety = "WB4269", PlantingDate = new DateTime(2025, 10, 1), EstimatedYield = 65 }
        };

        // Initialize Notes
        _notes = new List<Note>
        {
            new() { Id = "N001", CustomerId = "1", FarmId = "F001", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 11, 1, 9, 15, 0), Content = "Discussed potential early delivery options for corn contract. Customer prefers December delivery window.", IsPinned = false },
            new() { Id = "N002", CustomerId = "1", FarmId = "F001", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 10, 22, 14, 30, 0), Content = "Customer mentioned they are expanding operations next year. May need additional storage contracts.", IsPinned = false },
            new() { Id = "N003", CustomerId = "1", FarmId = "F001", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 9, 15, 11, 0, 0), Content = "Initial meeting went well. Customer is satisfied with current pricing and wants to continue working with us.", IsPinned = false },
            new() { Id = "N004", CustomerId = "2", FarmId = "F003", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 11, 5, 16, 45, 0), Content = "Customer inquired about basis contracts for next season. Scheduled follow-up for November 20th.", IsPinned = false },
            new() { Id = "N005", CustomerId = "2", FarmId = "F003", CreatedBy = "Michael Zhang", CreatedAt = new DateTime(2024, 10, 18, 10, 20, 0), Content = "Reviewed wheat delivery schedule. Everything on track. Customer is very satisfied with our service.", IsPinned = false },
            new() { Id = "N006", CustomerId = "2", FarmId = "F003", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 9, 28, 13, 15, 0), Content = "Discussed harvest timeline. Customer expects to start corn harvest around October 15th.", IsPinned = false }
        };

        // Initialize Stored Grain
        _storedGrain = new List<StoredGrain>
        {
            new() { Id = "S001", CustomerId = "1", FarmId = "F001", Crop = "Corn", Quantity = 15000, StorageStartDate = new DateTime(2024, 8, 15), StorageRate = 0.015m, Bin = "Bin A-12" },
            new() { Id = "S002", CustomerId = "1", FarmId = "F001", Crop = "Soybeans", Quantity = 8000, StorageStartDate = new DateTime(2024, 9, 1), StorageRate = 0.018m, Bin = "Bin B-5" },
            new() { Id = "S003", CustomerId = "2", FarmId = "F003", Crop = "Corn", Quantity = 25000, StorageStartDate = new DateTime(2024, 7, 20), StorageRate = 0.015m, Bin = "Bin C-8" },
            new() { Id = "S004", CustomerId = "2", FarmId = "F003", Crop = "Wheat", Quantity = 5000, StorageStartDate = new DateTime(2024, 6, 10), StorageRate = 0.012m, Bin = "Bin D-3" }
        };

        // Initialize Saved Lists (empty to start)
        _savedLists = new List<SavedList>();
    }

    // Customer methods
    public List<Customer> GetCustomers() => _customers;
    public Customer? GetCustomerById(string id) => _customers.FirstOrDefault(c => c.Id == id);

    public void UpdateCustomer(string customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds)
    {
        var customer = _customers.FirstOrDefault(c => c.Id == customerId);
        if (customer != null)
        {
            customer.Location = location;
            customer.Phone = phone;
            customer.Email = email;
            customer.FarmIds = farmIds;
            customer.LinkedProducerIds = linkedProducerIds;
            customer.TotalAcres = _farms.Where(f => farmIds.Contains(f.Id)).Sum(f => f.Acres);
        }
    }

    // Farm methods
    public List<Farm> GetFarms() => _farms;

    public List<Farm> GetFarmsByCustomer(string customerId)
    {
        var customer = _customers.FirstOrDefault(c => c.Id == customerId);
        if (customer == null) return new List<Farm>();
        return _farms.Where(f => customer.FarmIds.Contains(f.Id)).ToList();
    }

    public Farm? GetFarmById(string id) => _farms.FirstOrDefault(f => f.Id == id);

    public string CreateFarm(string name, string location, int acres)
    {
        var newId = $"F{(_farms.Count + 1).ToString().PadLeft(3, '0')}";
        _farms.Add(new Farm { Id = newId, Name = name, Location = location, Acres = acres });
        return newId;
    }

    // Contract methods
    public List<Contract> GetContracts() => _contracts;
    public List<Contract> GetContractsByCustomer(string customerId) => _contracts.Where(c => c.CustomerId == customerId).ToList();
    public List<Contract> GetContractsByFarm(string farmId) => _contracts.Where(c => c.FarmId == farmId).ToList();

    // Ticket methods
    public List<Ticket> GetTickets() => _tickets;
    public List<Ticket> GetTicketsByCustomer(string customerId) => _tickets.Where(t => t.CustomerId == customerId).ToList();
    public List<Ticket> GetTicketsByFarm(string farmId) => _tickets.Where(t => t.FarmId == farmId).ToList();

    // Planting Intention methods
    public List<PlantingIntention> GetPlantingIntentions() => _plantingIntentions;
    public List<PlantingIntention> GetPlantingIntentionsByCustomer(string customerId) => _plantingIntentions.Where(p => p.CustomerId == customerId).ToList();

    public void AddPlantingIntention(string customerId, string farmId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield)
    {
        var newId = $"P{(_plantingIntentions.Count + 1).ToString().PadLeft(3, '0')}";
        _plantingIntentions.Add(new PlantingIntention
        {
            Id = newId,
            CustomerId = customerId,
            FarmId = farmId,
            Crop = crop,
            Acres = acres,
            Variety = variety,
            PlantingDate = plantingDate,
            EstimatedYield = estimatedYield
        });
    }

    public void UpdatePlantingIntention(string intentionId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield)
    {
        var intention = _plantingIntentions.FirstOrDefault(p => p.Id == intentionId);
        if (intention != null)
        {
            intention.Crop = crop;
            intention.Acres = acres;
            intention.Variety = variety;
            intention.PlantingDate = plantingDate;
            intention.EstimatedYield = estimatedYield;
        }
    }

    // Note methods
    public List<Note> GetNotes() => _notes;
    public List<Note> GetNotesByCustomer(string customerId) => _notes.Where(n => n.CustomerId == customerId).ToList();

    public Note AddNote(string customerId, string content)
    {
        var newId = $"N{(_notes.Count + 1).ToString().PadLeft(3, '0')}";
        var note = new Note
        {
            Id = newId,
            CustomerId = customerId,
            FarmId = null,
            CreatedBy = "Current User",
            CreatedAt = DateTime.Now,
            Content = content,
            IsPinned = false
        };
        _notes.Add(note);
        return note;
    }

    public Note? ToggleNotePin(string noteId)
    {
        var note = _notes.FirstOrDefault(n => n.Id == noteId);
        if (note != null)
        {
            note.IsPinned = !note.IsPinned;
        }
        return note;
    }

    // Stored Grain methods
    public List<StoredGrain> GetStoredGrain() => _storedGrain;
    public List<StoredGrain> GetStoredGrainByCustomer(string customerId) => _storedGrain.Where(s => s.CustomerId == customerId).ToList();

    // Saved List methods
    public List<SavedList> GetSavedLists() => _savedLists;

    public void SaveList(string name, string query, List<string> customerIds)
    {
        var newId = $"L{(_savedLists.Count + 1).ToString().PadLeft(3, '0')}";
        _savedLists.Add(new SavedList
        {
            Id = newId,
            Name = name,
            Query = query,
            CustomerIds = customerIds,
            CreatedAt = DateTime.Now
        });
    }

    public void DeleteList(string listId)
    {
        var list = _savedLists.FirstOrDefault(l => l.Id == listId);
        if (list != null)
        {
            _savedLists.Remove(list);
        }
    }
}
