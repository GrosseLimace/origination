namespace GrainOriginatorPortal.Api.Interfaces;

/// <summary>
/// Interface defining data access operations for the Grain Originator Portal.
/// </summary>
public interface IDataService
{
    // =========================================================================
    // Customer Operations
    // =========================================================================

    /// <summary>Gets all customers, optionally filtered by trade unit.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    List<Customer> GetCustomers(List<string>? tradeUnits = null);

    /// <summary>Searches customers by name or code, optionally filtered by trade unit.</summary>
    /// <param name="searchTerm">The term to search for.</param>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    List<Customer> SearchCustomers(string searchTerm, List<string>? tradeUnits = null);

    /// <summary>Gets a single customer by their unique identifier.</summary>
    /// <param name="id">The customer's unique identifier.</param>
    /// <returns>The customer if found; otherwise, null.</returns>
    Customer? GetCustomerById(long id);

    /// <summary>Updates contact and relationship fields on an existing customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="location">The customer's location string.</param>
    /// <param name="phone">The customer's phone number.</param>
    /// <param name="email">The customer's email address.</param>
    /// <param name="farmIds">List of associated farm IDs.</param>
    /// <param name="linkedProducerIds">List of linked producer IDs.</param>
    void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds);

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    /// <summary>Gets all distinct trade unit codes.</summary>
    List<string> GetTradeUnits();

    /// <summary>Gets all trade unit groups with their associated trade units.</summary>
    List<TradeUnitGroup> GetTradeUnitGroups();

    // =========================================================================
    // Farm Operations
    // =========================================================================

    /// <summary>Gets all farms.</summary>
    List<Farm> GetFarms();

    /// <summary>Gets all farms associated with a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<Farm> GetFarmsByCustomer(long customerId);

    /// <summary>Gets a single farm by its identifier.</summary>
    /// <param name="id">The farm's string identifier.</param>
    /// <returns>The farm if found; otherwise, null.</returns>
    Farm? GetFarmById(string id);

    /// <summary>Creates a new farm record.</summary>
    /// <param name="name">The farm name.</param>
    /// <param name="location">The farm location description.</param>
    /// <param name="acres">The total acreage.</param>
    /// <returns>The newly created farm's identifier.</returns>
    string CreateFarm(string name, string location, int acres);

    // =========================================================================
    // Contract Operations
    // =========================================================================

    /// <summary>Gets all contracts, optionally filtered by trade unit.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    List<Contract> GetContracts(List<string>? tradeUnits = null);

    /// <summary>Gets all contracts for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<Contract> GetContractsByCustomer(long customerId);

    /// <summary>Gets all contracts associated with a specific farm.</summary>
    /// <param name="farmId">The farm's string identifier.</param>
    List<Contract> GetContractsByFarm(string farmId);

    /// <summary>Gets all pricing lines for a specific contract.</summary>
    /// <param name="sourceContractId">The source system contract identifier.</param>
    List<ContractPricingLine> GetPricingLines(string sourceContractId);

    /// <summary>Gets all pricing lines for a specific customer across all contracts.</summary>
    /// <param name="sourceCustomerId">The source system customer identifier.</param>
    List<ContractPricingLine> GetPricingLinesByCustomer(string sourceCustomerId);

    // =========================================================================
    // Ticket Operations
    // =========================================================================

    /// <summary>Gets all tickets, optionally filtered by trade unit.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    List<Ticket> GetTickets(List<string>? tradeUnits = null);

    /// <summary>Gets all tickets for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<Ticket> GetTicketsByCustomer(long customerId);

    /// <summary>Gets all tickets associated with a specific farm.</summary>
    /// <param name="farmId">The farm's string identifier.</param>
    List<Ticket> GetTicketsByFarm(string farmId);

    // =========================================================================
    // Planting Intention Operations
    // =========================================================================

    /// <summary>Gets all planting intentions across all customers.</summary>
    List<PlantingIntention> GetPlantingIntentions();

    /// <summary>Gets all planting intentions for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<PlantingIntention> GetPlantingIntentionsByCustomer(int customerId);

    /// <summary>Creates a new planting intention.</summary>
    /// <returns>The newly created planting intention.</returns>
    PlantingIntention AddPlantingIntention(int customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear);

    /// <summary>Updates an existing planting intention.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <returns>The updated planting intention if found; otherwise, null.</returns>
    PlantingIntention? UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear);

    /// <summary>Deletes a planting intention by its identifier.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    void DeletePlantingIntention(int intentionId);

    // =========================================================================
    // Note Operations
    // =========================================================================

    /// <summary>Gets all notes across all customers.</summary>
    List<Note> GetNotes();

    /// <summary>Gets all notes for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<Note> GetNotesByCustomer(long customerId);

    /// <summary>Creates a new note for a customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="content">The note text content.</param>
    /// <param name="tradeUnit">Optional trade unit association.</param>
    /// <returns>The newly created note.</returns>
    Note AddNote(long customerId, string content, string? tradeUnit = null);

    /// <summary>Toggles the pinned state of a note.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <returns>The updated note if found; otherwise, null.</returns>
    Note? ToggleNotePin(long noteId);

    /// <summary>Updates the text content of an existing note.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <param name="content">The new note text content.</param>
    /// <returns>The updated note if found; otherwise, null.</returns>
    Note? UpdateNote(long noteId, string content);

    /// <summary>Deletes a note by its identifier.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    void DeleteNote(long noteId);

    // =========================================================================
    // Producer Details Operations
    // =========================================================================

    /// <summary>Gets producer details for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <returns>The producer details if found; otherwise, null.</returns>
    ProducerDetails? GetProducerDetails(long customerId);

    /// <summary>Gets producer details for all customers.</summary>
    List<ProducerDetails> GetAllProducerDetails();

    /// <summary>Creates or updates producer details for a customer.</summary>
    /// <returns>The created or updated producer details record.</returns>
    ProducerDetails UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null);

    /// <summary>Deletes producer details for a customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    void DeleteProducerDetails(long customerId);

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    /// <summary>Gets dashboard planting estimates for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    List<DashboardPlantingEstimate> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear);

    /// <summary>Bulk creates or updates dashboard planting estimates.</summary>
    /// <param name="estimates">The list of estimates to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    void UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username);

    // =========================================================================
    // Dashboard Market Share Operations
    // =========================================================================

    /// <summary>Gets dashboard market share records for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    List<DashboardMarketShare> GetDashboardMarketShares(string tradeUnitKey, int plantingYear);

    /// <summary>Bulk creates or updates dashboard market share records.</summary>
    /// <param name="shares">The list of market share records to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    void UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username);

    // =========================================================================
    // Dashboard Actual Harvest Operations
    // =========================================================================

    /// <summary>Gets actual harvest records for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    List<DashboardActualHarvest> GetDashboardActualHarvest(string tradeUnitKey, int plantingYear);

    /// <summary>Bulk creates or updates actual harvest records.</summary>
    /// <param name="items">The list of harvest records to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    void UpsertDashboardActualHarvest(List<UpsertDashboardActualHarvestRequest> items, string username);

    /// <summary>Deletes an actual harvest record by its identifier.</summary>
    /// <param name="id">The harvest record's unique identifier.</param>
    void DeleteDashboardActualHarvest(int id);

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    /// <summary>Gets all commodities.</summary>
    List<Commodity> GetCommodities();

    // =========================================================================
    // Storage Operations
    // =========================================================================

    /// <summary>Gets all stored grain records.</summary>
    List<StoredGrain> GetStoredGrain();

    /// <summary>Gets stored grain records for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    List<StoredGrain> GetStoredGrainByCustomer(long customerId);

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    /// <summary>Gets all saved lists.</summary>
    List<SavedList> GetSavedLists();

    /// <summary>Creates a new saved list.</summary>
    /// <param name="name">The display name of the list.</param>
    /// <param name="query">The NLQ query string.</param>
    /// <param name="tradeUnits">Optional comma-separated trade unit filter.</param>
    /// <param name="filters">Optional serialized filter state.</param>
    /// <returns>The newly created saved list.</returns>
    SavedList SaveList(string name, string query, string? tradeUnits, string? filters = null);

    /// <summary>Updates an existing saved list.</summary>
    /// <param name="listId">The saved list's unique identifier.</param>
    /// <returns>The updated saved list if found; otherwise, null.</returns>
    SavedList? UpdateList(int listId, string name, string query, string? tradeUnits, string? filters = null);

    /// <summary>Deletes a saved list by its identifier.</summary>
    /// <param name="listId">The saved list's unique identifier.</param>
    void DeleteList(int listId);
}
