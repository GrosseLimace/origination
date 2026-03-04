using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Interface defining data access operations for the Grain Originator Portal.
/// </summary>
public interface IDataService
{
    // Customer Operations
    List<Customer> GetCustomers(List<string>? tradeUnits = null);
    List<Customer> SearchCustomers(string searchTerm, List<string>? tradeUnits = null);
    Customer? GetCustomerById(long id);
    void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds);

    // Trade Unit Operations
    List<string> GetTradeUnits();
    List<TradeUnitGroup> GetTradeUnitGroups();

    // Farm Operations
    List<Farm> GetFarms();
    List<Farm> GetFarmsByCustomer(long customerId);
    Farm? GetFarmById(string id);
    string CreateFarm(string name, string location, int acres);

    // Contract Operations
    List<Contract> GetContracts(List<string>? tradeUnits = null);
    List<Contract> GetContractsByCustomer(long customerId);
    List<Contract> GetContractsByFarm(string farmId);
    List<ContractPricingLine> GetPricingLines(string sourceContractId);
    List<ContractPricingLine> GetPricingLinesByCustomer(string sourceCustomerId);

    // Ticket Operations
    List<Ticket> GetTickets(List<string>? tradeUnits = null);
    List<Ticket> GetTicketsByCustomer(long customerId);
    List<Ticket> GetTicketsByFarm(string farmId);

    // Planting Intention Operations
    List<PlantingIntention> GetPlantingIntentions();
    List<PlantingIntention> GetPlantingIntentionsByCustomer(int customerId);
    PlantingIntention AddPlantingIntention(int customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear);
    PlantingIntention? UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear);
    void DeletePlantingIntention(int intentionId);

    // Note Operations
    List<Note> GetNotes();
    List<Note> GetNotesByCustomer(long customerId);
    Note AddNote(long customerId, string content, string? tradeUnit = null);
    Note? ToggleNotePin(long noteId);
    Note? UpdateNote(long noteId, string content);
    void DeleteNote(long noteId);

    // Producer Details Operations
    ProducerDetails? GetProducerDetails(long customerId);
    List<ProducerDetails> GetAllProducerDetails();
    ProducerDetails UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null);
    void DeleteProducerDetails(long customerId);

    // Dashboard Planting Estimate Operations
    List<DashboardPlantingEstimate> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear);
    void UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username);

    // Dashboard Market Share Operations
    List<DashboardMarketShare> GetDashboardMarketShares(string tradeUnitKey, int plantingYear);
    void UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username);

    // Dashboard Actual Harvest Operations
    List<DashboardActualHarvest> GetDashboardActualHarvest(string tradeUnitKey, int plantingYear);
    void UpsertDashboardActualHarvest(List<UpsertDashboardActualHarvestRequest> items, string username);
    void DeleteDashboardActualHarvest(int id);

    // Commodity Operations
    List<Commodity> GetCommodities();

    // Storage Operations
    List<StoredGrain> GetStoredGrain();
    List<StoredGrain> GetStoredGrainByCustomer(long customerId);

    // Saved List Operations
    List<SavedList> GetSavedLists();
    SavedList SaveList(string name, string query, string? tradeUnits, string? filters = null);
    void DeleteList(int listId);
}
