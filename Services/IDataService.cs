using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Services;

public interface IDataService
{
    // Customers
    List<Customer> GetCustomers();
    Customer? GetCustomerById(string id);
    void UpdateCustomer(string customerId, string location, string phone, string email, List<string> farmIds);

    // Farms
    List<Farm> GetFarms();
    List<Farm> GetFarmsByCustomer(string customerId);
    Farm? GetFarmById(string id);
    string CreateFarm(string name, string location, int acres);

    // Contracts
    List<Contract> GetContracts();
    List<Contract> GetContractsByCustomer(string customerId);
    List<Contract> GetContractsByFarm(string farmId);

    // Tickets
    List<Ticket> GetTickets();
    List<Ticket> GetTicketsByCustomer(string customerId);
    List<Ticket> GetTicketsByFarm(string farmId);

    // Planting Intentions
    List<PlantingIntention> GetPlantingIntentions();
    List<PlantingIntention> GetPlantingIntentionsByCustomer(string customerId);
    void AddPlantingIntention(string customerId, string farmId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);
    void UpdatePlantingIntention(string intentionId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);

    // Notes
    List<Note> GetNotes();
    List<Note> GetNotesByCustomer(string customerId);
    void AddNote(string customerId, string? farmId, string originatorName, string content);
    void ToggleNotePin(string noteId);

    // Stored Grain
    List<StoredGrain> GetStoredGrain();
    List<StoredGrain> GetStoredGrainByCustomer(string customerId);

    // Saved Lists
    List<SavedList> GetSavedLists();
    void SaveList(string name, string query, List<string> customerIds);
    void DeleteList(string listId);
}
