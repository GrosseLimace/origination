using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Interface defining data access operations for the Grain Originator Portal.
/// </summary>
public interface IDataService
{
    // Customer Operations
    List<Customer> GetCustomers();
    Customer? GetCustomerById(long id);
    void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds);

    // Farm Operations
    List<Farm> GetFarms();
    List<Farm> GetFarmsByCustomer(long customerId);
    Farm? GetFarmById(string id);
    string CreateFarm(string name, string location, int acres);

    // Contract Operations
    List<Contract> GetContracts();
    List<Contract> GetContractsByCustomer(long customerId);
    List<Contract> GetContractsByFarm(string farmId);

    // Ticket Operations
    List<Ticket> GetTickets();
    List<Ticket> GetTicketsByCustomer(long customerId);
    List<Ticket> GetTicketsByFarm(string farmId);

    // Planting Intention Operations
    List<PlantingIntention> GetPlantingIntentions();
    List<PlantingIntention> GetPlantingIntentionsByCustomer(long customerId);
    void AddPlantingIntention(long customerId, string farmId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);
    void UpdatePlantingIntention(string intentionId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);

    // Note Operations
    List<Note> GetNotes();
    List<Note> GetNotesByCustomer(long customerId);
    Note AddNote(long customerId, string content);
    Note? ToggleNotePin(string noteId);

    // Storage Operations
    List<StoredGrain> GetStoredGrain();
    List<StoredGrain> GetStoredGrainByCustomer(long customerId);

    // Saved List Operations
    List<SavedList> GetSavedLists();
    void SaveList(string name, string query, List<string> customerIds);
    void DeleteList(string listId);
}
