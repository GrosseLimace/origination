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

    public Task<List<Customer>> GetCustomers(List<string>? tradeUnits = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomers");

    public Task<List<Customer>> SearchCustomers(string searchTerm, List<string>? tradeUnits = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for SearchCustomers");

    public Task<Customer?> GetCustomerById(long id)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomerById");

    public Task UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateCustomer");

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public Task<List<string>> GetTradeUnits()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnits");

    public Task<List<TradeUnitGroup>> GetTradeUnitGroups()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnitGroups");

    // =========================================================================
    // Farm Operations
    // =========================================================================

    public Task<List<Farm>> GetFarms()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarms");

    public Task<List<Farm>> GetFarmsByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmsByCustomer");

    public Task<Farm?> GetFarmById(string id)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmById");

    public Task<string> CreateFarm(string name, string location, int acres)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for CreateFarm");

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public Task<List<Contract>> GetContracts(List<string>? tradeUnits = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContracts");

    public Task<List<Contract>> GetContractsByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByCustomer");

    public Task<List<Contract>> GetContractsByFarm(string farmId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByFarm");

    public Task<List<ContractPricingLine>> GetPricingLines(string sourceContractId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPricingLines");

    public Task<List<ContractPricingLine>> GetPricingLinesByCustomer(string sourceCustomerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPricingLinesByCustomer");

    // =========================================================================
    // Ticket Operations
    // =========================================================================

    public Task<List<Ticket>> GetTickets(List<string>? tradeUnits = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTickets");

    public Task<List<Ticket>> GetTicketsByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByCustomer");

    public Task<List<Ticket>> GetTicketsByFarm(string farmId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByFarm");

    // =========================================================================
    // Planting Intention Operations
    // =========================================================================

    public Task<List<PlantingIntention>> GetPlantingIntentions()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentions");

    public Task<List<PlantingIntention>> GetPlantingIntentionsByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentionsByCustomer");

    public Task<PlantingIntention> AddPlantingIntention(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for AddPlantingIntention");

    public Task<PlantingIntention?> UpdatePlantingIntention(int intentionId, string crop, string? type, string? description, int acres, int plantingYear)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdatePlantingIntention");

    public Task DeletePlantingIntention(int intentionId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeletePlantingIntention");

    // =========================================================================
    // Note Operations
    // Note: Notes are stored in the Origination database (not ODS), so these
    // may stay as direct SQL calls even after switching to APIM for ODS data.
    // Confirm with the APIM team whether Notes will be exposed via APIM.
    // =========================================================================

    public Task<List<Note>> GetNotes()
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<List<Note>> GetNotesByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note> AddNote(long customerId, string content, string? tradeUnit = null)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note?> ToggleNotePin(long noteId)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task<Note?> UpdateNote(long noteId, string content)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    public Task DeleteNote(long noteId)
        => throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");

    // =========================================================================
    // Producer Details Operations
    // =========================================================================

    public Task<ProducerDetails?> GetProducerDetails(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetProducerDetails");

    public Task<List<ProducerDetails>> GetAllProducerDetails()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetAllProducerDetails");

    public Task<ProducerDetails> UpsertProducerDetails(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertProducerDetails");

    public Task DeleteProducerDetails(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteProducerDetails");

    // =========================================================================
    // Storage Operations
    // =========================================================================

    public Task<List<StoredGrain>> GetStoredGrain()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrain");

    public Task<List<StoredGrain>> GetStoredGrainByCustomer(long customerId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrainByCustomer");

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    public Task<List<Commodity>> GetCommodities()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCommodities");

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public Task<List<SavedList>> GetSavedLists()
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetSavedLists");

    public Task<SavedList> SaveList(string name, string query, string? tradeUnits, string? filters = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for SaveList");

    public Task<SavedList?> UpdateList(int listId, string name, string query, string? tradeUnits, string? filters = null)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateList");

    public Task DeleteList(int listId)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteList");

    // Dashboard Planting Estimate Operations
    public Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimates(string tradeUnitKey, int plantingYear)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardPlantingEstimates");

    public Task UpsertDashboardPlantingEstimates(List<UpsertDashboardEstimateRequest> estimates, string username)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardPlantingEstimates");

    // Dashboard Market Share Operations
    public Task<List<DashboardMarketShare>> GetDashboardMarketShares(string tradeUnitKey, int plantingYear)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardMarketShares");

    public Task UpsertDashboardMarketShares(List<UpsertDashboardMarketShareRequest> shares, string username)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardMarketShares");

    // Dashboard Actual Harvest Operations
    public Task<List<DashboardActualHarvest>> GetDashboardActualHarvest(string tradeUnitKey, int plantingYear)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for GetDashboardActualHarvest");

    public Task UpsertDashboardActualHarvest(List<UpsertDashboardActualHarvestRequest> items, string username)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for UpsertDashboardActualHarvest");

    public Task DeleteDashboardActualHarvest(int id)
        => throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteDashboardActualHarvest");
}
