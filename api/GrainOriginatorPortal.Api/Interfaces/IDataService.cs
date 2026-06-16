namespace GrainOriginatorPortal.Api.Interfaces;

// AssignTradeUnitsResult / DeactivateTradeUnitResult moved to the Infrastructure layer
// (GrainOriginatorPortal.Infrastructure.Repositories) so the repository can return them
// directly; they're resolved here via the Api project's GlobalUsings.

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

    /// <summary>Searches the ODS customer master (base.vw_CurrentCustomers) for producers
    /// not yet onboarded into dbo.Customer. Used by the home-page search fallback to find
    /// producers who exist in CTRM but have no contract/ticket. Excludes anyone already
    /// in dbo.Customer.</summary>
    Task<List<Customer>> SearchOdsCustomersAsync(string searchTerm, CancellationToken cancellationToken = default);

    /// <summary>Reconciles a producer's MANUAL trade-unit assignments to exactly the given set.
    /// Onboards them from the ODS into dbo.Customer if they aren't there yet. Codes in the set are
    /// activated (or inserted) as manual; manual assignments NOT in the set are soft-deactivated
    /// (IsActive=false, row preserved so they can be re-added). Sync-sourced (IsManual=false)
    /// assignments are never touched. Idempotent — re-assigning an existing TU doesn't duplicate.</summary>
    Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken = default);

    /// <summary>Gets a producer's ACTIVE trade-unit memberships (code + IsManual flag + HasOpenActivity)
    /// so the edit dialog can show which trade units they appear on, which are editable vs locked, and
    /// which locked ones are "dormant" (no open contract/unapplied ticket) and therefore removable.</summary>
    Task<List<CustomerTradeUnitInfo>> GetCustomerTradeUnitsAsync(long customerId, CancellationToken cancellationToken = default);

    /// <summary>Returns the set of trade-unit codes the producer (by ScoularId) currently has OPEN activity
    /// in — an open purchase contract OR an active unapplied ticket (U/L, plus storage-gated C). Shared by
    /// the edit dialog's dormancy flag, the dormant-removal validation, and the CustomerSync bring-back pass
    /// so they all agree on "active".</summary>
    Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken = default);

    /// <summary>Removes a producer from a SYNC-SOURCED (locked) trade unit they're dormant in. Re-validates
    /// server-side that the producer has NO open contract / unapplied ticket in that TU (returns
    /// StillActive if they do), then soft-deactivates the membership and sets UserDeactivated=true so the
    /// nightly sync respects the removal until activity returns. Does not affect any other membership.</summary>
    Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken = default);

    /// <summary>Gets a single customer by their unique identifier.</summary>
    /// <param name="id">The customer's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The customer if found; otherwise, null.</returns>
    Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>Gets a single active customer by their source system customer identifier.</summary>
    Task<Customer?> GetCustomerByScoularIdAsync(string scoularId, CancellationToken cancellationToken = default);

    /// <summary>Gets customers whose ProducerDetails.LinkedProducerIds contains the given source customer id — i.e. customers that link TO this one (incoming links).</summary>
    Task<List<Customer>> GetCustomersLinkedToAsync(string scoularId, CancellationToken cancellationToken = default);

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
    Task<List<Contract>> GetContractsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default);

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
    /// <param name="scoularId">The source system customer identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken = default);

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
    Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default);

    /// <summary>Gets a customer's UNAPPLIED tickets only — fast per-producer fetch using a single
    /// CustomerCode predicate plus the U/L/C contract-prefix filter. The home page loads this on
    /// producer select; applied tickets are loaded lazily per-contract on contract expansion via
    /// <see cref="GetAppliedTicketsByContractAsync"/>.</summary>
    Task<List<Ticket>> GetUnappliedTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default);

    /// <summary>Gets the APPLIED tickets for a single contract, looked up by SourceContractId
    /// (the human-readable contract number). Single-literal predicate gives the optimizer the
    /// best chance at an index seek. Used by the contracts table when a row is expanded.</summary>
    Task<List<Ticket>> GetAppliedTicketsByContractAsync(string sourceContractId, CancellationToken cancellationToken = default);

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
    Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? category, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default);

    /// <summary>Updates an existing planting intention.</summary>
    /// <param name="intentionId">The planting intention's unique identifier.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The updated planting intention if found; otherwise, null.</returns>
    Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? category, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default);

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
    Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? scoularId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default);

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

    /// <summary>Gets the curated commodities flagged for the Planting Intentions crop dropdown.</summary>
    Task<List<Commodity>> GetPlantingCommoditiesAsync(CancellationToken cancellationToken = default);

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
    Task DeleteBidSheetBidsAsync(int locationId, string commodityCode, int? month = null, CancellationToken cancellationToken = default);

    /// <summary>Bulk upserts bids by finding or creating locations, then upserting each bid by (LocationId, CommodityCode, CropYear).</summary>
    Task BulkUpsertBidSheetBidsAsync(IEnumerable<GrainOriginatorPortal.Api.Models.Requests.UpsertBidSheetBidRequest> requests, string tradeUnitCode, string userId, CancellationToken cancellationToken = default);

    /// <summary>Gets the distinct crop years that have bids for a trade unit.</summary>
    Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets the distinct commodity codes that have bids for a trade unit.</summary>
    Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default);

    /// <summary>Gets the distinct months that have bids for a trade unit and crop year.</summary>
    Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken = default);

    /// <summary>Gets the saved location order for a user and trade unit key. Returns null if not set.</summary>
    Task<BidSheetLocationOrder?> GetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default);

    /// <summary>Creates or updates the location order for a user and trade unit key.</summary>
    Task SetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken = default);

    /// <summary>Gets the saved bid sheet preferences (e.g. selected crop) for a user and trade unit key. Returns null if not set.</summary>
    Task<BidSheetPreference?> GetBidSheetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default);

    /// <summary>Creates or updates the bid sheet preferences (crop, month, year) for a user and trade unit key.</summary>
    Task SetBidSheetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder = null, string? hiddenCrops = null, string? selectedMonths = null, string? printLayout = null, CancellationToken cancellationToken = default);

    // =========================================================================
    // Query Library Operations
    // =========================================================================

    /// <summary>Gets all active query library items, sorted by category then sort order.</summary>
    Task<List<QueryLibraryItem>> GetQueryLibraryAsync(CancellationToken cancellationToken = default);

    /// <summary>Logs a user's query library search for gap analysis.</summary>
    Task LogQuerySearchAsync(string searchText, int? matchedQueryId, CancellationToken cancellationToken = default);
}
