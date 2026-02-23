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

    public List<Customer> GetCustomers(List<string>? tradeUnits = null)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers?tradeUnits=UNIT1&tradeUnits=UNIT2
        // var queryString = tradeUnits != null ? string.Join("&", tradeUnits.Select(tu => $"tradeUnits={tu}")) : "";
        // var result = _httpClient.GetFromJsonAsync<List<Customer>>($"/ods/customers?{queryString}").Result;
        // return result ?? new List<Customer>();
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomers");
    }

    public List<Customer> SearchCustomers(string searchTerm, List<string>? tradeUnits = null)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers/search?searchTerm=John&tradeUnits=UNIT1
        throw new NotImplementedException("TODO: Wire up APIM endpoint for SearchCustomers");
    }

    public Customer? GetCustomerById(long id)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers/{id}
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetCustomerById");
    }

    public void UpdateCustomer(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: PUT /ods/customers/{customerId}
        // Note: APIM may not support writes to ODS - confirm with the APIM team
        throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdateCustomer");
    }

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public List<string> GetTradeUnits()
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/tradeunits
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnits");
    }

    public List<TradeUnitGroup> GetTradeUnitGroups()
    {
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTradeUnitGroups");
    }

    // =========================================================================
    // Farm Operations
    // =========================================================================

    public List<Farm> GetFarms()
    {
        // TODO: Replace with actual APIM endpoint path (if farms are exposed via APIM)
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarms");
    }

    public List<Farm> GetFarmsByCustomer(long customerId)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers/{customerId}/farms
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmsByCustomer");
    }

    public Farm? GetFarmById(string id)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/farms/{id}
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetFarmById");
    }

    public string CreateFarm(string name, string location, int acres)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: POST /ods/farms
        // Note: APIM may not support writes to ODS - confirm with the APIM team
        throw new NotImplementedException("TODO: Wire up APIM endpoint for CreateFarm");
    }

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public List<Contract> GetContracts(List<string>? tradeUnits = null)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/contracts?tradeUnits=UNIT1&tradeUnits=UNIT2
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContracts");
    }

    public List<Contract> GetContractsByCustomer(long customerId)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers/{customerId}/contracts
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByCustomer");
    }

    public List<Contract> GetContractsByFarm(string farmId)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/farms/{farmId}/contracts
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetContractsByFarm");
    }

    // =========================================================================
    // Ticket Operations
    // =========================================================================

    public List<Ticket> GetTickets(List<string>? tradeUnits = null)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/tickets?tradeUnits=UNIT1&tradeUnits=UNIT2
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTickets");
    }

    public List<Ticket> GetTicketsByCustomer(long customerId)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/customers/{customerId}/tickets
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByCustomer");
    }

    public List<Ticket> GetTicketsByFarm(string farmId)
    {
        // TODO: Replace with actual APIM endpoint path
        // Example: GET /ods/farms/{farmId}/tickets
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetTicketsByFarm");
    }

    // =========================================================================
    // Planting Intention Operations
    // =========================================================================

    public List<PlantingIntention> GetPlantingIntentions()
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentions");
    }

    public List<PlantingIntention> GetPlantingIntentionsByCustomer(string customerId)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetPlantingIntentionsByCustomer");
    }

    public PlantingIntention AddPlantingIntention(string customerId, string farmId, string crop, int acres, int plantingYear, int estimatedYield)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for AddPlantingIntention");
    }

    public PlantingIntention? UpdatePlantingIntention(string intentionId, string crop, int acres, int plantingYear, int estimatedYield)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for UpdatePlantingIntention");
    }

    public void DeletePlantingIntention(string intentionId)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for DeletePlantingIntention");
    }

    // =========================================================================
    // Note Operations
    // Note: Notes are stored in the Origination database (not ODS), so these
    // may stay as direct SQL calls even after switching to APIM for ODS data.
    // Confirm with the APIM team whether Notes will be exposed via APIM.
    // =========================================================================

    public List<Note> GetNotes()
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        // If via APIM: GET /originations/notes
        // If direct SQL: keep using SqlDataService for notes only
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    public List<Note> GetNotesByCustomer(long customerId)
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    public Note AddNote(long customerId, string content, string? tradeUnit = null)
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    public Note? ToggleNotePin(long noteId)
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    public Note? UpdateNote(long noteId, string content)
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    public void DeleteNote(long noteId)
    {
        // TODO: Confirm if Notes will go through APIM or stay as direct SQL
        throw new NotImplementedException("TODO: Confirm Notes approach with APIM team");
    }

    // =========================================================================
    // Storage Operations
    // =========================================================================

    public List<StoredGrain> GetStoredGrain()
    {
        // TODO: Replace with actual APIM endpoint path (if StoredGrain is exposed via APIM)
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrain");
    }

    public List<StoredGrain> GetStoredGrainByCustomer(long customerId)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetStoredGrainByCustomer");
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public List<SavedList> GetSavedLists()
    {
        // TODO: Replace with actual APIM endpoint path (if SavedLists are exposed via APIM)
        throw new NotImplementedException("TODO: Wire up APIM endpoint for GetSavedLists");
    }

    public void SaveList(string name, string query, List<string> customerIds)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for SaveList");
    }

    public void DeleteList(string listId)
    {
        // TODO: Replace with actual APIM endpoint path
        throw new NotImplementedException("TODO: Wire up APIM endpoint for DeleteList");
    }
}
