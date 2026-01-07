using GrainOriginatorPortal.Models;

namespace GrainOriginatorPortal.Services;

/// <summary>
/// Interface defining data access operations for the Grain Originator Portal.
/// </summary>
/// <remarks>
/// TODO: When connecting to real data, implement this interface with:
/// - Entity Framework Core for database access
/// - Or HTTP client for REST API calls
/// - Or gRPC client for high-performance scenarios
///
/// Consider adding:
/// - Async versions of all methods (GetCustomersAsync, etc.)
/// - Pagination support (skip, take parameters)
/// - Filtering/sorting parameters
/// - Cancellation token support
/// </remarks>
public interface IDataService
{
    #region Customer Operations

    /// <summary>
    /// Retrieves all customers.
    /// </summary>
    /// <returns>List of all customers in the system.</returns>
    /// <remarks>TODO: Add pagination and filtering for production use</remarks>
    List<Customer> GetCustomers();

    /// <summary>
    /// Retrieves a single customer by ID.
    /// </summary>
    /// <param name="id">The customer's unique identifier.</param>
    /// <returns>The customer if found, otherwise null.</returns>
    Customer? GetCustomerById(string id);

    /// <summary>
    /// Updates customer information.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="location">Updated location.</param>
    /// <param name="phone">Updated phone number.</param>
    /// <param name="email">Updated email address.</param>
    /// <param name="farmIds">Updated list of associated farm IDs.</param>
    void UpdateCustomer(string customerId, string location, string phone, string email, List<string> farmIds);

    #endregion

    #region Farm Operations

    /// <summary>
    /// Retrieves all farms.
    /// </summary>
    /// <returns>List of all farms in the system.</returns>
    List<Farm> GetFarms();

    /// <summary>
    /// Retrieves farms associated with a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of farms associated with the customer.</returns>
    List<Farm> GetFarmsByCustomer(string customerId);

    /// <summary>
    /// Retrieves a single farm by ID.
    /// </summary>
    /// <param name="id">The farm's unique identifier.</param>
    /// <returns>The farm if found, otherwise null.</returns>
    Farm? GetFarmById(string id);

    /// <summary>
    /// Creates a new farm.
    /// </summary>
    /// <param name="name">Farm name.</param>
    /// <param name="location">Farm location.</param>
    /// <param name="acres">Total acres.</param>
    /// <returns>The ID of the newly created farm.</returns>
    string CreateFarm(string name, string location, int acres);

    #endregion

    #region Contract Operations

    /// <summary>
    /// Retrieves all contracts.
    /// </summary>
    /// <returns>List of all contracts in the system.</returns>
    List<Contract> GetContracts();

    /// <summary>
    /// Retrieves contracts for a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of contracts for the customer.</returns>
    List<Contract> GetContractsByCustomer(string customerId);

    /// <summary>
    /// Retrieves contracts for a specific farm.
    /// </summary>
    /// <param name="farmId">The farm's unique identifier.</param>
    /// <returns>List of contracts for the farm.</returns>
    List<Contract> GetContractsByFarm(string farmId);

    #endregion

    #region Ticket Operations

    /// <summary>
    /// Retrieves all delivery tickets.
    /// </summary>
    /// <returns>List of all tickets in the system.</returns>
    List<Ticket> GetTickets();

    /// <summary>
    /// Retrieves tickets for a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of tickets for the customer.</returns>
    List<Ticket> GetTicketsByCustomer(string customerId);

    /// <summary>
    /// Retrieves tickets for a specific farm.
    /// </summary>
    /// <param name="farmId">The farm's unique identifier.</param>
    /// <returns>List of tickets for the farm.</returns>
    List<Ticket> GetTicketsByFarm(string farmId);

    #endregion

    #region Planting Intention Operations

    /// <summary>
    /// Retrieves all planting intentions.
    /// </summary>
    /// <returns>List of all planting intentions in the system.</returns>
    List<PlantingIntention> GetPlantingIntentions();

    /// <summary>
    /// Retrieves planting intentions for a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of planting intentions for the customer.</returns>
    List<PlantingIntention> GetPlantingIntentionsByCustomer(string customerId);

    /// <summary>
    /// Adds a new planting intention.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="farmId">The farm's unique identifier.</param>
    /// <param name="crop">Type of crop to be planted.</param>
    /// <param name="acres">Number of acres to plant.</param>
    /// <param name="variety">Seed variety.</param>
    /// <param name="plantingDate">Expected planting date.</param>
    /// <param name="estimatedYield">Estimated yield in bushels per acre.</param>
    void AddPlantingIntention(string customerId, string farmId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);

    /// <summary>
    /// Updates an existing planting intention.
    /// </summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <param name="crop">Updated crop type.</param>
    /// <param name="acres">Updated acres.</param>
    /// <param name="variety">Updated variety.</param>
    /// <param name="plantingDate">Updated planting date.</param>
    /// <param name="estimatedYield">Updated estimated yield.</param>
    void UpdatePlantingIntention(string intentionId, string crop, int acres, string variety, DateTime plantingDate, int estimatedYield);

    #endregion

    #region Note Operations

    /// <summary>
    /// Retrieves all notes.
    /// </summary>
    /// <returns>List of all notes in the system.</returns>
    List<Note> GetNotes();

    /// <summary>
    /// Retrieves notes for a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of notes for the customer.</returns>
    List<Note> GetNotesByCustomer(string customerId);

    /// <summary>
    /// Adds a new note.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="farmId">Optional farm ID for farm-specific notes.</param>
    /// <param name="originatorName">Name of the person creating the note.</param>
    /// <param name="content">The note content.</param>
    /// <remarks>TODO: Replace originatorName with userId when authentication is implemented</remarks>
    void AddNote(string customerId, string? farmId, string originatorName, string content);

    /// <summary>
    /// Toggles the pinned status of a note.
    /// </summary>
    /// <param name="noteId">The note's unique identifier.</param>
    void ToggleNotePin(string noteId);

    #endregion

    #region Storage Operations

    /// <summary>
    /// Retrieves all stored grain records.
    /// </summary>
    /// <returns>List of all stored grain records in the system.</returns>
    List<StoredGrain> GetStoredGrain();

    /// <summary>
    /// Retrieves stored grain for a specific customer.
    /// </summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>List of stored grain records for the customer.</returns>
    List<StoredGrain> GetStoredGrainByCustomer(string customerId);

    #endregion

    #region Saved List Operations

    /// <summary>
    /// Retrieves all saved customer lists.
    /// </summary>
    /// <returns>List of all saved lists.</returns>
    List<SavedList> GetSavedLists();

    /// <summary>
    /// Saves a new customer list.
    /// </summary>
    /// <param name="name">User-defined name for the list.</param>
    /// <param name="query">The natural language query used to generate the list.</param>
    /// <param name="customerIds">List of customer IDs in the saved list.</param>
    void SaveList(string name, string query, List<string> customerIds);

    /// <summary>
    /// Deletes a saved list.
    /// </summary>
    /// <param name="listId">The saved list's unique identifier.</param>
    void DeleteList(string listId);

    #endregion
}
