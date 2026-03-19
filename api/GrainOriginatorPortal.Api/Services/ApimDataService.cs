using System.Net.Http.Json;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

// =============================================================================
// APIM DATA SERVICE - FUTURE REPLACEMENT FOR SqlDataService
// =============================================================================
// This file is a skeleton ready for when Azure API Management (APIM) is set up.
//
// To activate:
//   1. Fill in the TODO endpoint URLs below with the actual APIM paths
//   2. Update Program.cs to register ApimDataService instead of SqlDataService
//      (instructions are in Program.cs next to the service registration)
//   3. Test each endpoint and adjust response deserialization as needed
//
// This class implements the same IDataService interface as SqlDataService,
// so no other code in the app needs to change.
// =============================================================================

public class ApimDataService : IDataService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<ApimDataService> _logger;

    // HttpClient is configured in Program.cs with:
    // - BaseAddress set to the APIM gateway URL
    // - Ocp-Apim-Subscription-Key header for authentication
    public ApimDataService(HttpClient httpClient, ILogger<ApimDataService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public Task<List<Customer>> GetCustomersAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomers");

    public Task<List<Customer>> SearchCustomersAsync(string searchTerm, List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for SearchCustomers");

    public Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomerById");

    public Task<Customer?> GetCustomerBySourceIdAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomerBySourceId");

    public Task UpdateCustomerAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateCustomer");

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public Task<List<string>> GetTradeUnitsAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnits");

    public Task<List<TradeUnitGroup>> GetTradeUnitGroupsAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnitGroups");

    // =========================================================================
    // Farm Operations
    // =========================================================================

    public Task<List<Farm>> GetFarmsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarms");

    public Task<List<Farm>> GetFarmsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmsByCustomer");

    public Task<Farm?> GetFarmByIdAsync(string id, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmById");

    public Task<string> CreateFarmAsync(string name, string location, int acres, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for CreateFarm");

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public Task<List<Contract>> GetContractsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContracts");

    public Task<List<Contract>> GetContractsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByCustomer");

    public Task<List<Contract>> GetContractsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByFarm");

    public Task<List<Contract>> GetContractsBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsBySourceId");

    public Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPricingLines");

    public Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPricingLinesByCustomer");

    // =========================================================================
    // Ticket Operations
    // =========================================================================

    public Task<List<Ticket>> GetTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTickets");

    public Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByCustomer");

    public Task<List<Ticket>> GetTicketsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByFarm");

    // =========================================================================
    // Planting Intention Operations
    // =========================================================================

    public Task<List<PlantingIntention>> GetPlantingIntentionsAsync(IEnumerable<string>? tradeUnits = null, int? plantingYear = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentions");

    public Task<List<PlantingIntention>> GetPlantingIntentionsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentionsByCustomer");

    public Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for AddPlantingIntention");

    public Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdatePlantingIntention");

    public Task DeletePlantingIntentionAsync(int intentionId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeletePlantingIntention");

    public Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentionById");

    // =========================================================================
    // Note Operations
    // Note: Notes are stored in the Origination database (not ODS), so these
    // may stay as direct SQL calls even after switching to APIM for ODS data.
    // Confirm with the APIM team whether Notes will be exposed via APIM.
    // =========================================================================

    public Task<List<Note>> GetNotesAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<List<Note>> GetNotesByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note?> ToggleNotePinAsync(long noteId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note?> UpdateNoteAsync(long noteId, string content, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task DeleteNoteAsync(long noteId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    // =========================================================================
    // Producer Details Operations
    // =========================================================================

    public Task<ProducerDetails?> GetProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetProducerDetails");

    public Task<List<ProducerDetails>> GetAllProducerDetailsAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetAllProducerDetails");

    public Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertProducerDetails");

    public Task DeleteProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteProducerDetails");

    // =========================================================================
    // Storage Operations
    // =========================================================================

    public Task<List<StoredGrain>> GetStoredGrainAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrain");

    public Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrainByCustomer");

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    public Task<List<Commodity>> GetCommoditiesAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCommodities");

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetSavedLists");

    public Task<SavedList> SaveListAsync(string name, string query, string? tradeUnits, string? filters = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for SaveList");

    public Task<SavedList?> UpdateListAsync(int listId, string name, string query, string? tradeUnits, string? filters = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateList");

    public Task DeleteListAsync(int listId, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteList");

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    public Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardPlantingEstimates");

    public Task UpsertDashboardPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, string username, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardPlantingEstimates");

    // =========================================================================
    // Dashboard Market Share Operations
    // =========================================================================

    public Task<List<DashboardMarketShare>> GetDashboardMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardMarketShares");

    public Task UpsertDashboardMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, string username, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardMarketShares");

    // =========================================================================
    // Dashboard Actual Harvest Operations
    // =========================================================================

    public Task<List<DashboardActualHarvest>> GetDashboardActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardActualHarvest");

    public Task UpsertDashboardActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, string username, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardActualHarvest");

    public Task DeleteDashboardActualHarvestAsync(int id, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteDashboardActualHarvest");

    // =========================================================================
    // Bid Sheet Operations
    // =========================================================================

    public Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetElevators");

    public Task<List<BidSheetEntry>> GetBidSheetEntriesAsync(string tradeUnitCode, int? cropYear = null, string? commodityCode = null, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetBidSheetEntries");

    public Task<BidSheetEntry> CreateBidSheetEntryAsync(BidSheetEntry entry, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for CreateBidSheetEntry");

    public Task<BidSheetEntry?> UpdateBidSheetEntryAsync(int id, BidSheetEntry entry, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateBidSheetEntry");

    public Task DeleteBidSheetEntryAsync(int id, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteBidSheetEntry");

    public Task BulkCreateBidSheetEntriesAsync(List<BidSheetEntry> entries, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for BulkCreateBidSheetEntries");

    public Task<BidReference?> GetBidReferenceAsync(string userId, string tradeUnitCode, string commodityCode, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetBidReference");

    public Task SetBidReferenceAsync(BidReference reference, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for SetBidReference");

    public Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetBidCropYears");

    public Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetBidCommodities");
}
