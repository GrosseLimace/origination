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
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Customer>> GetCustomersAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Searches customers by name or code, optionally filtered by trade unit.</summary>
    /// <param name="searchTerm">The term to search for.</param>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Customer>> SearchCustomersAsync(string searchTerm, List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets a single customer by their unique identifier.</summary>
    /// <param name="id">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The customer if found; otherwise, null.</returns>
    Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Gets a single active customer by their source system customer identifier.</summary>
    Task<Customer?> GetCustomerBySourceIdAsync(string sourceCustomerId, CancellationToken cancellationToken = default);

    /// <summary>Updates contact and relationship fields on an existing customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="location">The customer's location string.</param>
    /// <param name="phone">The customer's phone number.</param>
    /// <param name="email">The customer's email address.</param>
    /// <param name="farmIds">List of associated farm IDs.</param>
    /// <param name="linkedProducerIds">List of linked producer IDs.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task UpdateCustomerAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken = default);

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    /// <summary>Gets all distinct trade unit codes.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<string>> GetTradeUnitsAsync(CancellationToken cancellationToken = default);

    /// <summary>Gets all trade unit groups with their associated trade units.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<TradeUnitGroup>> GetTradeUnitGroupsAsync(CancellationToken cancellationToken = default);

    // =========================================================================
    // Farm Operations
    // =========================================================================

    /// <summary>Gets all farms, optionally filtered to allowed trade units.</summary>
    /// <param name="tradeUnits">Trade unit codes to restrict results to. Null means no filter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Farm>> GetFarmsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all farms associated with a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Farm>> GetFarmsByCustomerAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Gets a single farm by its identifier.</summary>
    /// <param name="id">The farm's string identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The farm if found; otherwise, null.</returns>
    Task<Farm?> GetFarmByIdAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Creates a new farm record.</summary>
    /// <param name="name">The farm name.</param>
    /// <param name="location">The farm location description.</param>
    /// <param name="acres">The total acreage.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The newly created farm's identifier.</returns>
    Task<string> CreateFarmAsync(string name, string location, int acres, CancellationToken cancellationToken = default);

    // =========================================================================
    // Contract Operations
    // =========================================================================

    /// <summary>Gets all contracts, optionally filtered by trade unit.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Contract>> GetContractsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all contracts for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Contract>> GetContractsByCustomerAsync(long customerId, string? sourceCustomerId = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all contracts associated with a specific farm.</summary>
    /// <param name="farmId">The farm's string identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Contract>> GetContractsByFarmAsync(string farmId, CancellationToken cancellationToken = default);

    /// <summary>Gets historical closed contracts for a customer from base.Contract (used by Contract Pacing year-over-year comparison).</summary>
    /// <param name="customerId">The internal customer id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Contract>> GetHistoricalContractsForPacingAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Gets all purchase contracts (open + closed) from base.Contract for a specific crop year, scoped to the given trade units. Used by the Planting Intentions Dashboard's Harvest &amp; Contracts tab so historical years aren't missing closed contracts.</summary>
    Task<List<Contract>> GetContractsByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken = default);

    /// <summary>Gets contracts matching a specific SourceContractId (used for entitlement resolution).</summary>
    /// <param name="sourceContractId">The source system contract identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Contract>> GetContractsBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken = default);

    /// <summary>Gets all pricing lines for a specific contract.</summary>
    /// <param name="sourceContractId">The source system contract identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken = default);

    /// <summary>Gets all pricing lines for a specific customer across all contracts.</summary>
    /// <param name="sourceCustomerId">The source system customer identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string sourceCustomerId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Ticket Operations
    // =========================================================================

    /// <summary>Gets all tickets, optionally filtered by trade unit.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Ticket>> GetTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets today's delivery tickets only, optionally filtered by trade unit. Fast path for Spot Loads.</summary>
    /// <param name="tradeUnits">Optional list of trade unit codes to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Ticket>> GetTodaysTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all tickets for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, string? sourceCustomerId = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all tickets associated with a specific farm.</summary>
    /// <param name="farmId">The farm's string identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Ticket>> GetTicketsByFarmAsync(string farmId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Planting Intention Operations
    // =========================================================================

    /// <summary>Gets planting intentions, optionally filtered by trade units and/or planting year.</summary>
    /// <param name="tradeUnits">Optional trade unit codes to filter by. If null/empty, returns all.</param>
    /// <param name="plantingYear">Optional planting year to filter by. If null, returns all years.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<PlantingIntention>> GetPlantingIntentionsAsync(IEnumerable<string>? tradeUnits = null, int? plantingYear = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all planting intentions for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<PlantingIntention>> GetPlantingIntentionsByCustomerAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Gets a single planting intention by its identifier.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default);

    /// <summary>Creates a new planting intention.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The newly created planting intention.</returns>
    Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Updates an existing planting intention.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated planting intention if found; otherwise, null.</returns>
    Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Deletes a planting intention by its identifier.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task DeletePlantingIntentionAsync(int intentionId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Note Operations
    // =========================================================================

    /// <summary>Gets notes, optionally filtered by trade units.</summary>
    /// <param name="tradeUnits">Optional trade unit codes to filter by. If null/empty, returns all.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Note>> GetNotesAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets all notes for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Note>> GetNotesByCustomerAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Gets a single note by its identifier.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default);

    /// <summary>Creates a new note for a customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="content">The note text content.</param>
    /// <param name="tradeUnit">Optional trade unit association.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The newly created note.</returns>
    Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default);

    /// <summary>Toggles the pinned state of a note.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated note if found; otherwise, null.</returns>
    Task<Note?> ToggleNotePinAsync(long noteId, CancellationToken cancellationToken = default);

    /// <summary>Updates the text content of an existing note.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <param name="content">The new note text content.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated note if found; otherwise, null.</returns>
    Task<Note?> UpdateNoteAsync(long noteId, string content, CancellationToken cancellationToken = default);

    /// <summary>Deletes a note by its identifier.</summary>
    /// <param name="noteId">The note's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task DeleteNoteAsync(long noteId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Producer Details Operations
    // =========================================================================

    /// <summary>Gets producer details for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The producer details if found; otherwise, null.</returns>
    Task<ProducerDetails?> GetProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Gets producer details for all customers.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<ProducerDetails>> GetAllProducerDetailsAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates or updates producer details for a customer.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The created or updated producer details record.</returns>
    Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default);

    /// <summary>Deletes producer details for a customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task DeleteProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    /// <summary>Gets all three dashboard datasets (estimates, market shares, actual harvest) in a single round-trip.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by (harvest uses year-1).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<DashboardSummaryResponse> GetDashboardSummaryAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Gets dashboard planting estimates for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Bulk creates or updates dashboard planting estimates.</summary>
    /// <param name="estimates">The list of estimates to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task UpsertDashboardPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, string username, CancellationToken cancellationToken = default);

    // =========================================================================
    // Dashboard Market Share Operations
    // =========================================================================

    /// <summary>Gets dashboard market share records for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<DashboardMarketShare>> GetDashboardMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Bulk creates or updates dashboard market share records.</summary>
    /// <param name="shares">The list of market share records to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task UpsertDashboardMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, string username, CancellationToken cancellationToken = default);

    // =========================================================================
    // Dashboard Actual Harvest Operations
    // =========================================================================

    /// <summary>Gets actual harvest records for a trade unit and planting year.</summary>
    /// <param name="tradeUnitKey">The trade unit key to filter by.</param>
    /// <param name="plantingYear">The planting year to filter by.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<DashboardActualHarvest>> GetDashboardActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Bulk creates or updates actual harvest records.</summary>
    /// <param name="items">The list of harvest records to upsert.</param>
    /// <param name="username">The username performing the operation.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task UpsertDashboardActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, string username, CancellationToken cancellationToken = default);

    /// <summary>Deletes an actual harvest record by its identifier.</summary>
    /// <param name="id">The harvest record's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task DeleteDashboardActualHarvestAsync(int id, CancellationToken cancellationToken = default);

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    /// <summary>Gets all commodities.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<Commodity>> GetCommoditiesAsync(CancellationToken cancellationToken = default);

    /// <summary>Gets commodity conversion factors (lbs per unit) from ODS.</summary>
    Task<List<CommodityConversion>> GetCommodityConversionsAsync(CancellationToken cancellationToken = default);

    /// <summary>Gets harvest delivery windows per commodity.</summary>
    Task<List<HarvestWindow>> GetHarvestWindowsAsync(CancellationToken cancellationToken = default);

    // =========================================================================
    // Storage Operations
    // =========================================================================

    /// <summary>Gets stored grain records, optionally filtered by trade units.</summary>
    /// <param name="tradeUnits">Optional trade unit codes to filter by. If null/empty, returns all.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<StoredGrain>> GetStoredGrainAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default);

    /// <summary>Gets stored grain records for a specific customer.</summary>
    /// <param name="customerId">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    /// <summary>Gets all saved lists.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates a new saved list.</summary>
    /// <param name="name">The display name of the list.</param>
    /// <param name="query">The NLQ query string.</param>
    /// <param name="tradeUnits">Optional comma-separated trade unit filter.</param>
    /// <param name="filters">Optional serialized filter state.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The newly created saved list.</returns>
    Task<SavedList> SaveListAsync(string name, string query, string? tradeUnits, string? filters = null, string? includedCustomerIds = null, string? excludedCustomerIds = null, CancellationToken cancellationToken = default);

    /// <summary>Updates an existing saved list.</summary>
    /// <param name="listId">The saved list's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated saved list if found; otherwise, null.</returns>
    Task<SavedList?> UpdateListAsync(int listId, string name, string query, string? tradeUnits, string? filters = null, string? includedCustomerIds = null, string? excludedCustomerIds = null, CancellationToken cancellationToken = default);

    /// <summary>Deletes a saved list by its identifier.</summary>
    /// <param name="listId">The saved list's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task DeleteListAsync(int listId, CancellationToken cancellationToken = default);

    // =========================================================================
    // Bid Sheet Operations
    // =========================================================================

    /// <summary>Gets elevator locations, optionally filtered by trade unit.</summary>
    Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode = null, CancellationToken cancellationToken = default);

    /// <summary>Gets bid sheet locations with their bids for a trade unit.</summary>
    Task<List<BidSheetLocation>> GetBidSheetLocationsAsync(string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets all bid sheet locations across all trade units (for map display).</summary>
    Task<List<BidSheetLocation>> GetAllBidSheetLocationsAsync(CancellationToken cancellationToken = default);

    /// <summary>Creates a new bid sheet location with its initial bids.</summary>
    Task<BidSheetLocation> CreateBidSheetLocationAsync(BidSheetLocation location, CancellationToken cancellationToken = default);

    /// <summary>Updates location metadata. Returns null if not found.</summary>
    Task<BidSheetLocation?> UpdateBidSheetLocationAsync(int id, BidSheetLocation location, CancellationToken cancellationToken = default);

    /// <summary>Deletes a bid sheet location and all its bids.</summary>
    Task DeleteBidSheetLocationAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>Deletes all bids for a specific commodity on a location.</summary>
    Task DeleteBidSheetBidsAsync(int locationId, string commodityCode, CancellationToken cancellationToken = default);

    /// <summary>Bulk upserts bids by finding or creating locations, then upserting each bid by (LocationId, CommodityCode, CropYear).</summary>
    Task BulkUpsertBidSheetBidsAsync(IEnumerable<GrainOriginatorPortal.Api.Models.Requests.UpsertBidSheetBidRequest> requests, string tradeUnitCode, string userId, CancellationToken cancellationToken = default);

    /// <summary>Gets the distinct crop years that have bids for a trade unit.</summary>
    Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets the distinct commodity codes that have bids for a trade unit.</summary>
    Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets the reference elevator for a user and trade unit. Returns null if not set.</summary>
    Task<BidSheetReference?> GetBidSheetReferenceAsync(string userId, string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Creates or updates the reference location for a user and trade unit.</summary>
    Task SetBidSheetReferenceAsync(string userId, string tradeUnitCode, int locationId, string name, CancellationToken cancellationToken = default);

    /// <summary>Clears the reference location for a user and trade unit.</summary>
    Task ClearBidSheetReferenceAsync(string userId, string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets the saved location order for a user and trade unit key. Returns null if not set.</summary>
    Task<BidSheetLocationOrder?> GetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default);

    /// <summary>Creates or updates the location order for a user and trade unit key.</summary>
    Task SetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken = default);
}
