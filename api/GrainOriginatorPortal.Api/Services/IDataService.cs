using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Interface defining data access operations for the Grain Originator Portal.
/// </summary>
public interface IDataService
{
    // Customer Operations
    Task<List<Customer>> GetCustomers(List<string>? tradeUnits = null);
    Task<List<Customer>> SearchCustomers(string searchTerm, List<string>? tradeUnits = null);
    Task<Customer?> GetCustomerById(long id);
    Task UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds);

    // Trade Unit Operations
    Task<List<string>> GetTradeUnits();
    Task<List<TradeUnitGroup>> GetTradeUnitGroups();

    // Farm Operations
    Task<List<Farm>> GetFarms();
    Task<List<Farm>> GetFarmsByCustomer(long customerId);
    Task<Farm?> GetFarmById(string id);
    Task<string> CreateFarm(string name, string location, int acres);

    // Contract Operations
    Task<List<Contract>> GetContracts(List<string>? tradeUnits = null);
    Task<List<Contract>> GetContractsByCustomer(long customerId);
    Task<List<Contract>> GetContractsByFarm(string farmId);
    Task<List<ContractPricingLine>> GetPricingLines(string sourceContractId);
    Task<List<ContractPricingLine>> GetPricingLinesByCustomer(string sourceCustomerId);

    // Ticket Operations
    Task<List<Ticket>> GetTickets(List<string>? tradeUnits = null);
    Task<List<Ticket>> GetTicketsByCustomer(long customerId);
    Task<List<Ticket>> GetTicketsByFarm(string farmId);

    // Planting Intention Operations
    Task<List<PlantingIntention>> GetPlantingIntentions();
    Task<List<PlantingIntention>> GetPlantingIntentionsByCustomer(long customerId);
    Task<PlantingIntention> AddPlantingIntention(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear);
    Task<PlantingIntention?> UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear);
    Task DeletePlantingIntention(int intentionId);

    // Note Operations
    Task<List<Note>> GetNotes();
    Task<List<Note>> GetNotesByCustomer(long customerId);
    Task<Note> AddNote(long customerId, string content, string? tradeUnit = null);
    Task<Note?> ToggleNotePin(long noteId);
    Task<Note?> UpdateNote(long noteId, string content);
    Task DeleteNote(long noteId);

    // Producer Details Operations
    Task<ProducerDetails?> GetProducerDetails(long customerId);
    Task<List<ProducerDetails>> GetAllProducerDetails();
    Task<ProducerDetails> UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null);
    Task DeleteProducerDetails(long customerId);

    // Dashboard Planting Estimate Operations
    Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear);
    Task UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username);

    // Dashboard Market Share Operations
    Task<List<DashboardMarketShare>> GetDashboardMarketShares(string tradeUnitKey, int plantingYear);
    Task UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username);

    // Dashboard Actual Harvest Operations
    Task<List<DashboardActualHarvest>> GetDashboardActualHarvest(string tradeUnitKey, int plantingYear);
    Task UpsertDashboardActualHarvest(List<UpsertDashboardActualHarvestRequest> items, string username);
    Task DeleteDashboardActualHarvest(int id);

    // Commodity Operations
    Task<List<Commodity>> GetCommodities();

    // Storage Operations
    Task<List<StoredGrain>> GetStoredGrain();
    Task<List<StoredGrain>> GetStoredGrainByCustomer(long customerId);

    // Saved List Operations
    Task<List<SavedList>> GetSavedLists();
    Task<SavedList> SaveList(string name, string query, string? tradeUnits, string? filters = null);
    Task<SavedList?> UpdateList(int listId, string name, string query, string? tradeUnits, string? filters = null);
    Task DeleteList(int listId);
}
