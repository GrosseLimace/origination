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

    // Ticket Operations
    List<Ticket> GetTickets(List<string>? tradeUnits = null);
    List<Ticket> GetTicketsByCustomer(long customerId);
    List<Ticket> GetTicketsByFarm(string farmId);

    // Planting Intention Operations
    List<PlantingIntention> GetPlantingIntentions();
    List<PlantingIntention> GetPlantingIntentionsByCustomer(string customerId);
    PlantingIntention AddPlantingIntention(string customerId, string farmId, string crop, int acres, int plantingYear, int estimatedYield);
    PlantingIntention? UpdatePlantingIntention(string intentionId, string crop, int acres, int plantingYear, int estimatedYield);
    void DeletePlantingIntention(string intentionId);

    // Note Operations
    List<Note> GetNotes();
    List<Note> GetNotesByCustomer(long customerId);
    Note AddNote(long customerId, string content, string? tradeUnit = null);
    Note? ToggleNotePin(long noteId);
    Note? UpdateNote(long noteId, string content);
    void DeleteNote(long noteId);

    // Storage Operations
    List<StoredGrain> GetStoredGrain();
    List<StoredGrain> GetStoredGrainByCustomer(long customerId);

    // Saved List Operations
    List<SavedList> GetSavedLists();
    void SaveList(string name, string query, List<string> customerIds);
    void DeleteList(string listId);
}
