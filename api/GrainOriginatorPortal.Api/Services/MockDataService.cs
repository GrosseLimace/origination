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

        // Initialize Contracts (using actual crop names: IR/DL variants)
        _contracts = new List<Contract>
        {
            // Customer 1 - John Anderson
            new() { Id = "C001", CustomerId = "1", FarmId = "F001", ContractNumber = "C001", Crop = "IR Corn", Quantity = 50000, Unit = "bushels", Price = 4.85m, DeliveryStart = new DateTime(2024, 10, 1), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C002", CustomerId = "1", FarmId = "F001", ContractNumber = "C002", Crop = "IR Beans", Quantity = 30000, Unit = "bushels", Price = 12.50m, DeliveryStart = new DateTime(2024, 9, 15), DeliveryEnd = new DateTime(2024, 11, 30), Status = ContractStatus.Active, Signed = false },
            new() { Id = "C005", CustomerId = "1", FarmId = "F002", ContractNumber = "C005", Crop = "DL YC", Quantity = 40000, Unit = "bushels", Price = 4.90m, DeliveryStart = new DateTime(2024, 10, 15), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true },
            // Customer 2 - Sarah Mitchell
            new() { Id = "C003", CustomerId = "2", FarmId = "F003", ContractNumber = "C003", Crop = "IR Corn", Quantity = 80000, Unit = "bushels", Price = 4.90m, DeliveryStart = new DateTime(2024, 10, 1), DeliveryEnd = new DateTime(2025, 1, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C004", CustomerId = "2", FarmId = "F003", ContractNumber = "C004", Crop = "IR HRWW", Quantity = 20000, Unit = "bushels", Price = 6.25m, DeliveryStart = new DateTime(2024, 7, 1), DeliveryEnd = new DateTime(2024, 8, 31), Status = ContractStatus.Fulfilled, Signed = true },
            new() { Id = "C007", CustomerId = "2", FarmId = "F003", ContractNumber = "C007", Crop = "DL YSB", Quantity = 45000, Unit = "bushels", Price = 12.75m, DeliveryStart = new DateTime(2024, 9, 20), DeliveryEnd = new DateTime(2024, 11, 30), Status = ContractStatus.Active, Signed = true },
            // Customer 3 - Robert Johnson
            new() { Id = "C006", CustomerId = "3", FarmId = "F004", ContractNumber = "C006", Crop = "DL YC", Quantity = 35000, Unit = "bushels", Price = 4.80m, DeliveryStart = new DateTime(2024, 11, 1), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Pending, Signed = false },
            new() { Id = "C008", CustomerId = "3", FarmId = "F004", ContractNumber = "C008", Crop = "DL Milo", Quantity = 25000, Unit = "bushels", Price = 5.10m, DeliveryStart = new DateTime(2024, 10, 15), DeliveryEnd = new DateTime(2024, 12, 15), Status = ContractStatus.Active, Signed = true },
            // Customer 4 - Emily Chen
            new() { Id = "C009", CustomerId = "4", FarmId = "F005", ContractNumber = "C009", Crop = "IR Corn", Quantity = 65000, Unit = "bushels", Price = 4.95m, DeliveryStart = new DateTime(2024, 10, 1), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C010", CustomerId = "4", FarmId = "F005", ContractNumber = "C010", Crop = "IR Beans", Quantity = 38000, Unit = "bushels", Price = 12.60m, DeliveryStart = new DateTime(2024, 9, 10), DeliveryEnd = new DateTime(2024, 11, 15), Status = ContractStatus.Active, Signed = true },
            new() { Id = "C011", CustomerId = "4", FarmId = "F005", ContractNumber = "C011", Crop = "IR Milo", Quantity = 28000, Unit = "bushels", Price = 5.25m, DeliveryStart = new DateTime(2024, 10, 20), DeliveryEnd = new DateTime(2024, 12, 20), Status = ContractStatus.Active, Signed = false },
            // Customer 5 - Michael Brown
            new() { Id = "C012", CustomerId = "5", FarmId = "F006", ContractNumber = "C012", Crop = "DL HRWW", Quantity = 30000, Unit = "bushels", Price = 6.15m, DeliveryStart = new DateTime(2024, 7, 1), DeliveryEnd = new DateTime(2024, 8, 31), Status = ContractStatus.Fulfilled, Signed = true },
            new() { Id = "C013", CustomerId = "5", FarmId = "F006", ContractNumber = "C013", Crop = "DL YC", Quantity = 42000, Unit = "bushels", Price = 4.85m, DeliveryStart = new DateTime(2024, 10, 10), DeliveryEnd = new DateTime(2024, 12, 31), Status = ContractStatus.Active, Signed = true }
        };

        // Initialize Tickets with realistic weights for 30-80% delivery progress (using actual crop names)
        _tickets = new List<Ticket>
        {
            // Customer 1 - IR Corn contract C001 (50,000 bu target, ~45% delivered)
            new() { Id = "T001", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-001", Date = new DateTime(2024, 10, 15), Crop = "IR Corn", GrossWeight = 82000, TareWeight = 32000, NetWeight = 560000, Moisture = 15.5m, TestWeight = 56.2m },
            new() { Id = "T002", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-002", Date = new DateTime(2024, 10, 18), Crop = "IR Corn", GrossWeight = 81800, TareWeight = 32000, NetWeight = 504000, Moisture = 16.2m, TestWeight = 55.8m },
            new() { Id = "T005", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-005", Date = new DateTime(2024, 10, 25), Crop = "IR Corn", GrossWeight = 79000, TareWeight = 32000, NetWeight = 196000, Moisture = 15.1m, TestWeight = 56.5m },
            // Customer 1 - IR Beans contract C002 (30,000 bu target, ~35% delivered)
            new() { Id = "T003", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-003", Date = new DateTime(2024, 9, 22), Crop = "IR Beans", GrossWeight = 68000, TareWeight = 32000, NetWeight = 378000, Moisture = 13.1m, TestWeight = 58.4m },
            new() { Id = "T006", CustomerId = "1", FarmId = "F001", TicketNumber = "TKT-2024-006", Date = new DateTime(2024, 10, 5), Crop = "IR Beans", GrossWeight = 65000, TareWeight = 32000, NetWeight = 252000, Moisture = 12.8m, TestWeight = 59.1m },
            // Customer 1 - DL YC from F002
            new() { Id = "T014", CustomerId = "1", FarmId = "F002", TicketNumber = "TKT-2024-014", Date = new DateTime(2024, 10, 20), Crop = "DL YC", GrossWeight = 76000, TareWeight = 32000, NetWeight = 392000, Moisture = 17.2m, TestWeight = 54.8m },
            // Customer 2 - IR Corn contract C003 (80,000 bu target, ~60% delivered)
            new() { Id = "T004", CustomerId = "2", FarmId = "F003", TicketNumber = "TKT-2024-004", Date = new DateTime(2024, 10, 20), Crop = "IR Corn", GrossWeight = 93200, TareWeight = 33000, NetWeight = 1344000, Moisture = 14.8m, TestWeight = 57.1m },
            new() { Id = "T007", CustomerId = "2", FarmId = "F003", TicketNumber = "TKT-2024-007", Date = new DateTime(2024, 10, 28), Crop = "IR Corn", GrossWeight = 91500, TareWeight = 33000, NetWeight = 1344000, Moisture = 14.5m, TestWeight = 57.3m },
            // Customer 2 - DL YSB
            new() { Id = "T015", CustomerId = "2", FarmId = "F003", TicketNumber = "TKT-2024-015", Date = new DateTime(2024, 9, 25), Crop = "DL YSB", GrossWeight = 69000, TareWeight = 33000, NetWeight = 324000, Moisture = 12.9m, TestWeight = 58.2m },
            // Customer 3 - DL Milo
            new() { Id = "T008", CustomerId = "3", FarmId = "F004", TicketNumber = "TKT-2024-008", Date = new DateTime(2024, 10, 22), Crop = "DL Milo", GrossWeight = 74000, TareWeight = 31000, NetWeight = 301000, Moisture = 14.2m, TestWeight = 59.8m },
            new() { Id = "T009", CustomerId = "3", FarmId = "F004", TicketNumber = "TKT-2024-009", Date = new DateTime(2024, 10, 28), Crop = "DL Milo", GrossWeight = 72000, TareWeight = 31000, NetWeight = 287000, Moisture = 14.5m, TestWeight = 59.5m },
            // Customer 4 - IR Corn
            new() { Id = "T010", CustomerId = "4", FarmId = "F005", TicketNumber = "TKT-2024-010", Date = new DateTime(2024, 10, 12), Crop = "IR Corn", GrossWeight = 88000, TareWeight = 33000, NetWeight = 770000, Moisture = 15.8m, TestWeight = 56.8m },
            new() { Id = "T011", CustomerId = "4", FarmId = "F005", TicketNumber = "TKT-2024-011", Date = new DateTime(2024, 10, 18), Crop = "IR Corn", GrossWeight = 87500, TareWeight = 33000, NetWeight = 763000, Moisture = 15.5m, TestWeight = 57.0m },
            // Customer 4 - IR Beans
            new() { Id = "T012", CustomerId = "4", FarmId = "F005", TicketNumber = "TKT-2024-012", Date = new DateTime(2024, 9, 15), Crop = "IR Beans", GrossWeight = 71000, TareWeight = 33000, NetWeight = 380000, Moisture = 12.5m, TestWeight = 58.9m },
            // Customer 5 - DL YC
            new() { Id = "T013", CustomerId = "5", FarmId = "F006", TicketNumber = "TKT-2024-013", Date = new DateTime(2024, 10, 15), Crop = "DL YC", GrossWeight = 78000, TareWeight = 32000, NetWeight = 460000, Moisture = 16.8m, TestWeight = 55.2m }
        };

        // Initialize Planting Intentions (using actual crop names: IR/DL variants)
        _plantingIntentions = new List<PlantingIntention>
        {
            // Customer 1 - John Anderson (F001 and F002)
            new() { Id = "P001", CustomerId = "1", FarmId = "F001", Crop = "IR Corn", Acres = 400, Variety = "Pioneer P1197", PlantingDate = new DateTime(2025, 4, 25), EstimatedYield = 215 },
            new() { Id = "P002", CustomerId = "1", FarmId = "F001", Crop = "IR Beans", Acres = 200, Variety = "Asgrow AG46X6", PlantingDate = new DateTime(2025, 5, 10), EstimatedYield = 60 },
            new() { Id = "P003", CustomerId = "1", FarmId = "F002", Crop = "DL YC", Acres = 400, Variety = "DeKalb DKC57-39", PlantingDate = new DateTime(2025, 4, 30), EstimatedYield = 100 },
            new() { Id = "P004", CustomerId = "1", FarmId = "F002", Crop = "DL HRWW", Acres = 200, Variety = "WB4269", PlantingDate = new DateTime(2024, 10, 10), EstimatedYield = 50 },
            // Customer 2 - Sarah Mitchell (F003)
            new() { Id = "P005", CustomerId = "2", FarmId = "F003", Crop = "IR Corn", Acres = 1400, Variety = "DeKalb DKC62-54", PlantingDate = new DateTime(2025, 4, 20), EstimatedYield = 215 },
            new() { Id = "P006", CustomerId = "2", FarmId = "F003", Crop = "DL YSB", Acres = 800, Variety = "Channel 4518R2X", PlantingDate = new DateTime(2025, 5, 5), EstimatedYield = 30 },
            new() { Id = "P007", CustomerId = "2", FarmId = "F003", Crop = "IR HRWW", Acres = 200, Variety = "Everest 143 CL", PlantingDate = new DateTime(2024, 10, 5), EstimatedYield = 75 },
            // Customer 3 - Robert Johnson (F004)
            new() { Id = "P008", CustomerId = "3", FarmId = "F004", Crop = "DL YC", Acres = 500, Variety = "Pioneer P1870", PlantingDate = new DateTime(2025, 5, 1), EstimatedYield = 100 },
            new() { Id = "P009", CustomerId = "3", FarmId = "F004", Crop = "DL Milo", Acres = 300, Variety = "NK 180", PlantingDate = new DateTime(2025, 5, 20), EstimatedYield = 75 },
            // Customer 4 - Emily Chen (F005)
            new() { Id = "P010", CustomerId = "4", FarmId = "F005", Crop = "IR Corn", Acres = 900, Variety = "Pioneer P2089", PlantingDate = new DateTime(2025, 4, 18), EstimatedYield = 215 },
            new() { Id = "P011", CustomerId = "4", FarmId = "F005", Crop = "IR Beans", Acres = 500, Variety = "Asgrow AG53X9", PlantingDate = new DateTime(2025, 5, 8), EstimatedYield = 60 },
            new() { Id = "P012", CustomerId = "4", FarmId = "F005", Crop = "IR Milo", Acres = 200, Variety = "Dekalb DKS 53-67", PlantingDate = new DateTime(2025, 5, 25), EstimatedYield = 120 },
            // Customer 5 - Michael Brown (F006)
            new() { Id = "P013", CustomerId = "5", FarmId = "F006", Crop = "DL HRWW", Acres = 400, Variety = "Everest 250W", PlantingDate = new DateTime(2024, 10, 8), EstimatedYield = 50 },
            new() { Id = "P014", CustomerId = "5", FarmId = "F006", Crop = "DL YC", Acres = 550, Variety = "Channel 196-53", PlantingDate = new DateTime(2025, 4, 28), EstimatedYield = 100 }
        };

        // Initialize Notes (updated with actual crop names)
        _notes = new List<Note>
        {
            // Customer 1 - John Anderson
            new() { Id = "N001", CustomerId = "1", FarmId = "F001", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 11, 1, 9, 15, 0), Content = "Discussed potential early delivery options for IR Corn contract. Customer prefers December delivery window.", IsPinned = false },
            new() { Id = "N002", CustomerId = "1", FarmId = "F001", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 10, 22, 14, 30, 0), Content = "Customer mentioned they are expanding operations next year. May need additional storage contracts.", IsPinned = false },
            new() { Id = "N003", CustomerId = "1", FarmId = "F001", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 9, 15, 11, 0, 0), Content = "Initial meeting went well. Customer is satisfied with current pricing and wants to continue working with us.", IsPinned = false },
            // Customer 2 - Sarah Mitchell
            new() { Id = "N004", CustomerId = "2", FarmId = "F003", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 11, 5, 16, 45, 0), Content = "Customer inquired about basis contracts for next season. Scheduled follow-up for November 20th.", IsPinned = false },
            new() { Id = "N005", CustomerId = "2", FarmId = "F003", CreatedBy = "Michael Zhang", CreatedAt = new DateTime(2024, 10, 18, 10, 20, 0), Content = "Reviewed IR HRWW delivery schedule. Everything on track. Customer is very satisfied with our service.", IsPinned = false },
            new() { Id = "N006", CustomerId = "2", FarmId = "F003", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 9, 28, 13, 15, 0), Content = "Discussed harvest timeline. Customer expects to start IR Corn harvest around October 15th.", IsPinned = false },
            // Customer 3 - Robert Johnson
            new() { Id = "N007", CustomerId = "3", FarmId = "F004", CreatedBy = "Sarah Chen", CreatedAt = new DateTime(2024, 11, 3, 14, 0, 0), Content = "Customer interested in locking in pricing for DL YC next season. Will send formal offer by end of week.", IsPinned = false },
            new() { Id = "N008", CustomerId = "3", FarmId = "F004", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 10, 10, 10, 30, 0), Content = "Discussed DL Milo quality concerns from last delivery. Customer satisfied with test weight adjustments made.", IsPinned = false },
            // Customer 4 - Emily Chen
            new() { Id = "N009", CustomerId = "4", FarmId = "F005", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 11, 6, 11, 20, 0), Content = "Excellent rapport with this customer. They're considering adding IR Milo to their rotation next year.", IsPinned = false },
            new() { Id = "N010", CustomerId = "4", FarmId = "F005", CreatedBy = "Michael Zhang", CreatedAt = new DateTime(2024, 10, 25, 15, 45, 0), Content = "Customer requested quote for additional IR Beans contract. Will follow up with pricing tomorrow.", IsPinned = false },
            new() { Id = "N011", CustomerId = "4", FarmId = "F005", CreatedBy = "Sarah Chen", CreatedAt = new DateTime(2024, 10, 8, 9, 0, 0), Content = "Farm visit scheduled for next month. They want to discuss long-term storage options.", IsPinned = false },
            // Customer 5 - Michael Brown
            new() { Id = "N012", CustomerId = "5", FarmId = "F006", CreatedBy = "David Thompson", CreatedAt = new DateTime(2024, 11, 2, 13, 30, 0), Content = "Customer completed DL HRWW deliveries on time. Looking ahead to DL YC harvest season.", IsPinned = false },
            new() { Id = "N013", CustomerId = "5", FarmId = "F006", CreatedBy = "Lisa Martinez", CreatedAt = new DateTime(2024, 10, 12, 16, 15, 0), Content = "Discussed eSign enrollment. Customer is hesitant but open to learning more about the benefits.", IsPinned = false }
        };

        // Initialize Stored Grain (using actual crop names)
        _storedGrain = new List<StoredGrain>
        {
            // Customer 1 - John Anderson
            new() { Id = "S001", CustomerId = "1", FarmId = "F001", Crop = "IR Corn", Quantity = 15000, StorageStartDate = new DateTime(2024, 8, 15), StorageRate = 0.015m, Bin = "Bin A-12" },
            new() { Id = "S002", CustomerId = "1", FarmId = "F001", Crop = "IR Beans", Quantity = 8000, StorageStartDate = new DateTime(2024, 9, 1), StorageRate = 0.018m, Bin = "Bin B-5" },
            new() { Id = "S003", CustomerId = "1", FarmId = "F002", Crop = "DL YC", Quantity = 12000, StorageStartDate = new DateTime(2024, 8, 22), StorageRate = 0.015m, Bin = "Bin F-7" },
            // Customer 2 - Sarah Mitchell
            new() { Id = "S004", CustomerId = "2", FarmId = "F003", Crop = "IR Corn", Quantity = 25000, StorageStartDate = new DateTime(2024, 7, 20), StorageRate = 0.015m, Bin = "Bin C-8" },
            new() { Id = "S005", CustomerId = "2", FarmId = "F003", Crop = "IR HRWW", Quantity = 5000, StorageStartDate = new DateTime(2024, 6, 10), StorageRate = 0.012m, Bin = "Bin D-3" },
            new() { Id = "S006", CustomerId = "2", FarmId = "F003", Crop = "DL YSB", Quantity = 18000, StorageStartDate = new DateTime(2024, 9, 5), StorageRate = 0.018m, Bin = "Bin C-15" },
            // Customer 3 - Robert Johnson
            new() { Id = "S007", CustomerId = "3", FarmId = "F004", Crop = "DL Milo", Quantity = 10000, StorageStartDate = new DateTime(2024, 8, 28), StorageRate = 0.014m, Bin = "Bin G-4" },
            // Customer 4 - Emily Chen
            new() { Id = "S008", CustomerId = "4", FarmId = "F005", Crop = "IR Corn", Quantity = 22000, StorageStartDate = new DateTime(2024, 8, 10), StorageRate = 0.015m, Bin = "Bin H-9" },
            new() { Id = "S009", CustomerId = "4", FarmId = "F005", Crop = "IR Beans", Quantity = 14000, StorageStartDate = new DateTime(2024, 9, 8), StorageRate = 0.018m, Bin = "Bin H-11" },
            // Customer 5 - Michael Brown
            new() { Id = "S010", CustomerId = "5", FarmId = "F006", Crop = "DL YC", Quantity = 16000, StorageStartDate = new DateTime(2024, 8, 18), StorageRate = 0.015m, Bin = "Bin J-2" }
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

    public PlantingIntention AddPlantingIntention(string customerId, string farmId, string crop, int acres, DateTime plantingDate, int estimatedYield)
    {
        var newId = $"P{(_plantingIntentions.Count + 1).ToString().PadLeft(3, '0')}";
        var intention = new PlantingIntention
        {
            Id = newId,
            CustomerId = customerId,
            FarmId = farmId,
            Crop = crop,
            Acres = acres,
            PlantingDate = plantingDate,
            EstimatedYield = estimatedYield
        };
        _plantingIntentions.Add(intention);
        return intention;
    }

    public PlantingIntention? UpdatePlantingIntention(string intentionId, string crop, int acres, DateTime plantingDate, int estimatedYield)
    {
        var intention = _plantingIntentions.FirstOrDefault(p => p.Id == intentionId);
        if (intention != null)
        {
            intention.Crop = crop;
            intention.Acres = acres;
            intention.PlantingDate = plantingDate;
            intention.EstimatedYield = estimatedYield;
        }
        return intention;
    }

    public void DeletePlantingIntention(string intentionId)
    {
        var intention = _plantingIntentions.FirstOrDefault(p => p.Id == intentionId);
        if (intention != null)
        {
            _plantingIntentions.Remove(intention);
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

    public Note? UpdateNote(string noteId, string content)
    {
        var note = _notes.FirstOrDefault(n => n.Id == noteId);
        if (note != null)
        {
            note.Content = content;
        }
        return note;
    }

    public void DeleteNote(string noteId)
    {
        var note = _notes.FirstOrDefault(n => n.Id == noteId);
        if (note != null)
        {
            _notes.Remove(note);
        }
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
