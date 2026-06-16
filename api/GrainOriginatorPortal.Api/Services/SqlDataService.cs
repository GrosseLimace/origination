using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// SQL Server implementation of IDataService using Entity Framework Core.
/// Provides data access to Azure SQL Database with managed identity authentication.
/// </summary>
public class SqlDataService : IDataService
{
    private readonly ILogger<SqlDataService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IMemoryCache _cache;
    // Phase 2: domain repositories are introduced one at a time; SqlDataService forwards to them
    // during the transition. Once all domains are migrated, SqlDataService + IDataService are deleted.
    private readonly IQueryLibraryRepository _queryLibraryRepository;
    private readonly ICommodityRepository _commodityRepository;
    private readonly IStoredGrainRepository _storedGrainRepository;
    private readonly ISavedListRepository _savedListRepository;
    private readonly IDisplayNameLookupRepository _displayNameLookup;
    private readonly IProducerDetailsRepository _producerDetailsRepository;
    private readonly IPlantingIntentionRepository _plantingIntentionRepository;
    private readonly INoteRepository _noteRepository;
    private readonly IDashboardRepository _dashboardRepository;
    private readonly ITicketRepository _ticketRepository;
    private readonly IContractRepository _contractRepository;
    private readonly IBidSheetRepository _bidSheetRepository;
    private readonly ICustomerRepository _customerRepository;
    private readonly IFarmRepository _farmRepository;

    public SqlDataService(ILogger<SqlDataService> logger, IHttpContextAccessor httpContextAccessor, IMemoryCache cache, IQueryLibraryRepository queryLibraryRepository, ICommodityRepository commodityRepository, IStoredGrainRepository storedGrainRepository, ISavedListRepository savedListRepository, IDisplayNameLookupRepository displayNameLookup, IProducerDetailsRepository producerDetailsRepository, IFarmRepository farmRepository, IPlantingIntentionRepository plantingIntentionRepository, INoteRepository noteRepository, IDashboardRepository dashboardRepository, ITicketRepository ticketRepository, IContractRepository contractRepository, IBidSheetRepository bidSheetRepository, ICustomerRepository customerRepository)
    {
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
        _cache = cache;
        _queryLibraryRepository = queryLibraryRepository;
        _commodityRepository = commodityRepository;
        _storedGrainRepository = storedGrainRepository;
        _savedListRepository = savedListRepository;
        _displayNameLookup = displayNameLookup;
        _producerDetailsRepository = producerDetailsRepository;
        _plantingIntentionRepository = plantingIntentionRepository;
        _noteRepository = noteRepository;
        _dashboardRepository = dashboardRepository;
        _ticketRepository = ticketRepository;
        _contractRepository = contractRepository;
        _bidSheetRepository = bidSheetRepository;
        _customerRepository = customerRepository;
        _farmRepository = farmRepository;
    }

    private string GetTraceId() =>
        _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
        ?? _httpContextAccessor.HttpContext?.TraceIdentifier
        ?? "no-trace";

    /// <summary>
    /// Returns a stable, unique identifier for the current user.
    /// Priority: preferred_username (UPN) > UPN claim > oid (AAD object id) > Identity.Name > "System".
    /// The display-name claim ("name") is intentionally NOT used — display names can collide across
    /// users and are unstable, which would corrupt CreatedBy/ModifiedBy ownership on persisted rows.
    /// For user-facing display, use <see cref="ResolveDisplayNamesAsync"/> to convert UPN to the
    /// Azure AD display name via the UserTradeUnitSnapshot lookup.
    /// </summary>
    private string GetCurrentUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        return user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst(System.Security.Claims.ClaimTypes.Upn)?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name
            ?? "System";
    }

    /// <summary>
    /// Builds a UPN -> display-name dictionary from <c>UserTradeUnitSnapshot</c>. The snapshot
    /// table stores the short UPN form (e.g. "CEgr") while persisted CreatedBy values are the full
    /// UPN ("CEgr@scoular.com"), so we match on the short form and register both forms in the
    /// resulting dictionary to make <see cref="ApplyDisplayName"/> a simple lookup.
    /// Rows not found in the snapshot are absent from the dictionary; callers fall back to the
    /// original value.
    /// </summary>
    private Task<Dictionary<string, string>> ResolveDisplayNamesAsync(IEnumerable<string> userIds, CancellationToken cancellationToken) =>
        _displayNameLookup.ResolveAsync(userIds, cancellationToken);

    /// <summary>Replace UPN in a single value with its display name, or leave unchanged if unknown.</summary>
    private static string ApplyDisplayName(string? upn, IReadOnlyDictionary<string, string> map) =>
        !string.IsNullOrEmpty(upn) && map.TryGetValue(upn, out var dn) ? dn : (upn ?? string.Empty);

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public async Task<List<Customer>> GetCustomersAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.GetAsync(tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Customer table/column not found (SQL {Number}) — returning empty customer list [{TraceId}]",
                ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving customers — returning empty customer list [{TraceId}]",
                GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customers [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Customer>> SearchCustomersAsync(string searchTerm, List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.SearchAsync(searchTerm, tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Customer table/column not found (SQL {Number}) — returning empty search results [{TraceId}]",
                ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error searching customers — returning empty search results [{TraceId}]",
                GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error searching customers for term: {SearchTerm} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                searchTerm, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Searches the ODS customer master (base.vw_CurrentCustomers) for producers not yet
    /// onboarded into the app. Used by the home-page search fallback so a user can find a
    /// producer who exists in CTRM but has no contract/ticket (and therefore never synced
    /// into dbo.Customer). Filters to active, non-duplicate producers (IndustryCode1='PR')
    /// matching name / ScoularId / SourceCustomerId, and EXCLUDES anyone already in
    /// dbo.Customer so the results never contain a producer we already have (no dupes).
    /// </summary>
    public async Task<List<Customer>> SearchOdsCustomersAsync(string searchTerm, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.SearchOdsAsync(searchTerm, cancellationToken);
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB error in ODS customer search — returning empty [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in ODS customer search for term: {SearchTerm} [{TraceId}]", searchTerm, GetTraceId());
            throw;
        }
    }

    public async Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.GetByIdAsync(id, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                id, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Customer?> GetCustomerByScoularIdAsync(string scoularId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.GetByScoularIdAsync(scoularId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer by source ID {ScoularId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                scoularId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Returns customers whose ProducerDetails.LinkedProducerIds contains the given source id —
    /// i.e. customers that link TO this one (incoming / reverse links). Used by the cross-customer
    /// search path so the customer profile can show bidirectional linked producers even when no TU
    /// is selected and the main customer roster is empty.
    /// </summary>
    public async Task<List<Customer>> GetCustomersLinkedToAsync(string scoularId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _customerRepository.GetLinkedToAsync(scoularId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving incoming linked customers for source {SourceId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                scoularId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            return [];
        }
    }

    public async Task UpdateCustomerAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken = default)
    {
        try
        {
            await _customerRepository.UpdateAsync(customerId, location, phone, email, farmIds, linkedProducerIds, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Reconciles a producer's MANUAL trade-unit assignments to exactly <paramref name="tradeUnitCodes"/>.
    /// See <see cref="ICustomerRepository.AssignTradeUnitsAsync"/> for the full reconcile semantics.
    /// </summary>
    public Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken = default) =>
        _customerRepository.AssignTradeUnitsAsync(customerId, tradeUnitCodes, cancellationToken);

    public async Task<List<CustomerTradeUnitInfo>> GetCustomerTradeUnitsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        var memberships = await _customerRepository.GetTradeUnitsAsync(customerId, cancellationToken);
        return memberships
            .Select(m => new CustomerTradeUnitInfo
            {
                TradeUnit = m.TradeUnit,
                IsManual = m.IsManual,
                HasOpenActivity = m.HasOpenActivity
            })
            .ToList();
    }

    /// <summary>
    /// Returns the trade-unit codes the producer (by ScoularId) currently has OPEN activity in.
    /// PUBLIC so CustomerSyncService's bring-back pass calls the EXACT same rule. See
    /// <see cref="ICustomerRepository.GetOpenActivityTradeUnitsAsync"/>.
    /// </summary>
    public Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken) =>
        _customerRepository.GetOpenActivityTradeUnitsAsync(scoularId, cancellationToken);

    public Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken = default) =>
        _customerRepository.DeactivateDormantTradeUnitAsync(customerId, tradeUnit, cancellationToken);

    // =========================================================================
    // Commodity Operations
    // =========================================================================

    public async Task<List<Commodity>> GetCommoditiesAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "commodities:active";
        if (_cache.TryGetValue(cacheKey, out List<Commodity>? cached) && cached is not null)
            return cached;

        try
        {
            // Fast read-only query — sync runs at startup via SyncCommoditiesAsync
            var result = (await _commodityRepository.GetActiveAsync(cancellationToken)).ToList();

            _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
                Size = 1
            });
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Commodity>> GetPlantingCommoditiesAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "commodities:planting";
        if (_cache.TryGetValue(cacheKey, out List<Commodity>? cached) && cached is not null)
            return cached;

        try
        {
            // Curated subset for the Planting Intentions crop dropdown — same source as
            // GetCommoditiesAsync, narrowed to the ShowInPlantingIntentions flag.
            var result = (await _commodityRepository.GetPlantingAsync(cancellationToken)).ToList();

            _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
                Size = 1
            });
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<CommodityConversion>> GetCommodityConversionsAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "commodity-conversions";
        if (_cache.TryGetValue(cacheKey, out List<CommodityConversion>? cached) && cached is not null)
            return cached;

        var result = (await _commodityRepository.GetConversionsAsync(cancellationToken)).ToList();

        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1),
            Size = 1
        });
        return result;
    }

    public async Task<List<HarvestWindow>> GetHarvestWindowsAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "harvest-windows";
        if (_cache.TryGetValue(cacheKey, out List<HarvestWindow>? cached) && cached is not null)
            return cached;

        var result = (await _commodityRepository.GetHarvestWindowsAsync(cancellationToken)).ToList();

        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1),
            Size = 1
        });
        return result;
    }

    /// <summary>
    /// Syncs the Commodities table from ODS contract/ticket data.
    /// Called once at app startup — not on every API request.
    /// </summary>
    public async Task SyncCommoditiesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var total = await _commodityRepository.SyncAsync(cancellationToken);
            _logger.LogInformation("Commodity sync complete ({Count} total)", total);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            // Don't throw — sync failure shouldn't prevent app startup
        }
    }

    // =========================================================================
    // Farm Operations - DISABLED: Farms table doesn't exist in ODS
    // =========================================================================

    public Task<List<Farm>> GetFarmsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default) =>
        _farmRepository.GetAsync(tradeUnits, cancellationToken);

    public Task<List<Farm>> GetFarmsByCustomerAsync(long customerId, CancellationToken cancellationToken = default) =>
        _farmRepository.GetByCustomerAsync(customerId, cancellationToken);

    public Task<Farm?> GetFarmByIdAsync(string id, CancellationToken cancellationToken = default) =>
        _farmRepository.GetByIdAsync(id, cancellationToken);

    public Task<string> CreateFarmAsync(string name, string location, int acres, CancellationToken cancellationToken = default) =>
        _farmRepository.CreateAsync(name, location, acres, cancellationToken);

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public async Task<List<Contract>> GetContractsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetAsync(tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Contracts view not accessible or missing a mapped column in this environment — returning empty list. SQL {Number}: {Error} [{TraceId}]",
                ex.Number, ex.Message, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving contracts — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Contract>> GetContractsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetByCustomerAsync(customerId, scoularId, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Contracts view missing column or object for customer {CustomerId} — returning empty list. SQL {Number} [{TraceId}]",
                customerId, ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving contracts for customer {CustomerId} — returning empty list [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Loads historical closed contracts from base.Contract for the Contract Pacing year-over-year comparison.
    /// Only returns closed purchase contracts from the current or prior crop year for the given customer.
    /// The main contracts endpoint already delivers open contracts — this fills in the historical gap.
    /// </summary>
    public async Task<List<Contract>> GetHistoricalContractsForPacingAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetHistoricalForPacingAsync(customerId, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "base.Contract view/column not found — returning empty historical pacing list. SQL {Number} [{TraceId}]",
                ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving historical pacing contracts for customer {CustomerId} [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving historical pacing contracts for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Loads ALL purchase contracts (open + closed) for a specific crop year from base.Contract,
    /// scoped to the given trade units. Used by the Planting Intentions Dashboard's Harvest &amp; Contracts
    /// tab so that selecting an older planting year doesn't drop closed historical contracts that
    /// vw_CurrentContracts has filtered out.
    /// </summary>
    public async Task<List<Contract>> GetContractsByCropYearAsync(int cropYear, List<string>? tradeUnits, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetByCropYearAsync(cropYear, tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "base.Contract not accessible for crop year {CropYear} — returning empty list. SQL {Number} [{TraceId}]",
                cropYear, ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving contracts for crop year {CropYear} [{TraceId}]", cropYear, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for crop year {CropYear} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                cropYear, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Contract>> GetContractsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetByFarmAsync(farmId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for farm {FarmId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                farmId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Contract>> GetContractsBySourceIdAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetBySourceIdAsync(sourceContractId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving contracts for sourceContractId {SourceContractId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceContractId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetPricingLinesAsync(sourceContractId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for contract {ContractId}. Returning empty list. Error: {Error}", sourceContractId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _contractRepository.GetPricingLinesByCustomerAsync(scoularId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for customer {CustomerId}. Returning empty list. Error: {Error}", scoularId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    // =========================================================================
    // Ticket Operations - Loads from vw_CurrentTickets in ODS
    // NOTE: ~2 million tickets exist, so queries are carefully limited
    // =========================================================================

    public async Task<List<Ticket>> GetTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetAsync(tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            // 207 = Invalid column name (e.g. TicketType not yet in Dev ODS view)
            // 208 = Invalid object name (view doesn't exist in this environment)
            _logger.LogWarning(ex, "Tickets view not accessible or missing a mapped column in this environment — returning empty list. SQL {Number}: {Error} [{TraceId}]",
                ex.Number, ex.Message, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving tickets — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is InvalidCastException or InvalidOperationException or OverflowException)
        {
            // EF Core type mapping mismatch (e.g. ODS column type changed) — return empty rather than 500
            _logger.LogWarning(ex, "EF Core mapping error retrieving tickets (ODS schema mismatch?) — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Ticket>> GetTodaysTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetTodaysAsync(tradeUnits, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view not accessible in this environment — returning empty today's tickets. SQL {Number}: {Error} [{TraceId}]",
                ex.Number, ex.Message, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving today's tickets — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is InvalidCastException or InvalidOperationException or OverflowException)
        {
            _logger.LogWarning(ex, "EF Core mapping error retrieving today's tickets — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving today's tickets [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetByCustomerAsync(customerId, scoularId, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view missing column or object for customer {CustomerId} — returning empty list. SQL {Number} [{TraceId}]",
                customerId, ex.Number, GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB connection error retrieving tickets for customer {CustomerId} — returning empty list [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    /// <summary>
    /// Fast per-producer unapplied-tickets fetch. Single CustomerCode predicate plus the U/L/C
    /// contract-prefix filter — the optimizer's most-selective shape against vw_CurrentTickets.
    /// C-prefix (customer-storage) tickets are then gated against active storage so priced-out
    /// grain stops showing. Used by the home page on producer select; applied tickets are loaded
    /// lazily per-contract (see <see cref="GetAppliedTicketsByContractAsync"/>).
    /// </summary>
    public async Task<List<Ticket>> GetUnappliedTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetUnappliedByCustomerAsync(customerId, scoularId, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view missing column/object — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB error retrieving unapplied tickets for customer {CustomerId} — returning empty list [{TraceId}]",
                customerId, GetTraceId());
            return [];
        }
    }

    /// <summary>
    /// Lazy per-contract applied-tickets fetch. Single-literal predicate on ContractNumber gives
    /// the optimizer its best shot at an index seek. Used by the contracts table when a row is expanded.
    /// </summary>
    public async Task<List<Ticket>> GetAppliedTicketsByContractAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetAppliedByContractAsync(sourceContractId, cancellationToken);
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view missing column/object — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB error retrieving applied tickets for contract {ContractNumber} — returning empty list [{TraceId}]",
                sourceContractId, GetTraceId());
            return [];
        }
    }

    public async Task<List<Ticket>> GetTicketsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _ticketRepository.GetByFarmAsync(farmId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving tickets for farm {FarmId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                farmId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Planting Intention Operations - Uses dbo.ProducerPlantingIntentions table
    // =========================================================================

    public async Task<List<PlantingIntention>> GetPlantingIntentionsAsync(IEnumerable<string>? tradeUnits = null, int? plantingYear = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var results = await _plantingIntentionRepository.GetAsync(tradeUnits, plantingYear, cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                results.Select(r => r.CreatedBy).Concat(results.Select(r => r.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var r in results)
            {
                r.CreatedBy = ApplyDisplayName(r.CreatedBy, nameMap);
                r.ModifiedBy = string.IsNullOrEmpty(r.ModifiedBy) ? r.ModifiedBy : ApplyDisplayName(r.ModifiedBy, nameMap);
            }
            return results;
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning("PlantingIntentions not accessible (table missing or DB connection failure) — returning empty list. Error: {Error}", ex.Message);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<PlantingIntention>> GetPlantingIntentionsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            var results = await _plantingIntentionRepository.GetByCustomerAsync(customerId, cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                results.Select(r => r.CreatedBy).Concat(results.Select(r => r.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var r in results)
            {
                r.CreatedBy = ApplyDisplayName(r.CreatedBy, nameMap);
                r.ModifiedBy = string.IsNullOrEmpty(r.ModifiedBy) ? r.ModifiedBy : ApplyDisplayName(r.ModifiedBy, nameMap);
            }
            return results;
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning("PlantingIntentions not accessible for customer {CustomerId} (table missing or DB connection failure) — returning empty list. Error: {Error}", customerId, ex.Message);
            return new List<PlantingIntention>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving planting intentions for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default) =>
        _plantingIntentionRepository.GetByIdAsync(intentionId, cancellationToken);

    public async Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? category, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = await _plantingIntentionRepository.AddAsync(customerId, customerName, customerCode, tradeUnit,
                crop, category, type, description, acres, plantingYear, GetCurrentUser(), cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(new[] { intention.CreatedBy }, cancellationToken);
            intention.CreatedBy = ApplyDisplayName(intention.CreatedBy, nameMap);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating planting intention for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? category, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = await _plantingIntentionRepository.UpdateAsync(intentionId, crop, category, type,
                description, acres, plantingYear, GetCurrentUser(), cancellationToken);
            if (intention == null)
            {
                return null;
            }

            var nameMap = await ResolveDisplayNamesAsync(
                new[] { intention.CreatedBy, intention.ModifiedBy ?? string.Empty }, cancellationToken);
            intention.CreatedBy = ApplyDisplayName(intention.CreatedBy, nameMap);
            intention.ModifiedBy = string.IsNullOrEmpty(intention.ModifiedBy) ? intention.ModifiedBy : ApplyDisplayName(intention.ModifiedBy, nameMap);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating planting intention {Id} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                intentionId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeletePlantingIntentionAsync(int intentionId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _plantingIntentionRepository.DeleteAsync(intentionId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting planting intention {Id} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                intentionId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Note Operations - Uses dbo.Notes table in Origination database
    // =========================================================================

    public async Task<List<Note>> GetNotesAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var notes = await _noteRepository.GetAsync(tradeUnits, cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                notes.Select(n => n.CreatedBy).Concat(notes.Select(n => n.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var n in notes)
            {
                n.CreatedBy = ApplyDisplayName(n.CreatedBy, nameMap);
                n.ModifiedBy = string.IsNullOrEmpty(n.ModifiedBy) ? n.ModifiedBy : ApplyDisplayName(n.ModifiedBy, nameMap);
            }
            return notes;
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible (likely permissions issue). Returning empty list. Error: {Error}", ex.Message);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<Note>> GetNotesByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            var notes = await _noteRepository.GetByCustomerAsync(customerId, cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                notes.Select(n => n.CreatedBy).Concat(notes.Select(n => n.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var n in notes)
            {
                n.CreatedBy = ApplyDisplayName(n.CreatedBy, nameMap);
                n.ModifiedBy = string.IsNullOrEmpty(n.ModifiedBy) ? n.ModifiedBy : ApplyDisplayName(n.ModifiedBy, nameMap);
            }
            return notes;
        }
        catch (SqlException ex) when (ex.Number == 208) // Invalid object name
        {
            _logger.LogWarning("Notes table not accessible for customer {CustomerId}. Returning empty list.", customerId);
            return new List<Note>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving notes for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default) =>
        _noteRepository.GetByIdAsync(noteId, cancellationToken);

    public async Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _noteRepository.AddAsync(customerId, content, tradeUnit, GetCurrentUser(), cancellationToken);
            // Resolve display name on the return path so the client sees "Caden Egr", not the UPN.
            // DB still has the UPN for stable ownership filtering.
            var nameMap = await ResolveDisplayNamesAsync(new[] { note.CreatedBy }, cancellationToken);
            note.CreatedBy = ApplyDisplayName(note.CreatedBy, nameMap);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating note for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Note?> ToggleNotePinAsync(long noteId, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _noteRepository.TogglePinAsync(noteId, cancellationToken);
            if (note == null)
            {
                return null;
            }

            var nameMap = await ResolveDisplayNamesAsync(
                new[] { note.CreatedBy, note.ModifiedBy ?? string.Empty }, cancellationToken);
            note.CreatedBy = ApplyDisplayName(note.CreatedBy, nameMap);
            note.ModifiedBy = string.IsNullOrEmpty(note.ModifiedBy) ? note.ModifiedBy : ApplyDisplayName(note.ModifiedBy, nameMap);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error toggling pin for note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Note?> UpdateNoteAsync(long noteId, string content, CancellationToken cancellationToken = default)
    {
        try
        {
            var note = await _noteRepository.UpdateAsync(noteId, content, GetCurrentUser(), cancellationToken);
            if (note == null)
            {
                return null;
            }

            var nameMap = await ResolveDisplayNamesAsync(
                new[] { note.CreatedBy, note.ModifiedBy ?? string.Empty }, cancellationToken);
            note.CreatedBy = ApplyDisplayName(note.CreatedBy, nameMap);
            note.ModifiedBy = string.IsNullOrEmpty(note.ModifiedBy) ? note.ModifiedBy : ApplyDisplayName(note.ModifiedBy, nameMap);
            return note;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteNoteAsync(long noteId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _noteRepository.DeleteAsync(noteId, GetCurrentUser(), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting note {NoteId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                noteId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Producer Details Operations - Uses dbo.ProducerDetails table in Origination database
    // =========================================================================

    public async Task<ProducerDetails?> GetProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            var pd = await _producerDetailsRepository.GetAsync(customerId, cancellationToken);
            if (pd == null) return null;

            var nameMap = await ResolveDisplayNamesAsync(new[] { pd.CreatedBy, pd.ModifiedBy ?? string.Empty }, cancellationToken);
            pd.CreatedBy = ApplyDisplayName(pd.CreatedBy, nameMap);
            pd.ModifiedBy = string.IsNullOrEmpty(pd.ModifiedBy) ? pd.ModifiedBy : ApplyDisplayName(pd.ModifiedBy, nameMap);
            return pd;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving producer details for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<List<ProducerDetails>> GetAllProducerDetailsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var all = await _producerDetailsRepository.GetAllAsync(cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                all.Select(p => p.CreatedBy).Concat(all.Select(p => p.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var p in all)
            {
                p.CreatedBy = ApplyDisplayName(p.CreatedBy, nameMap);
                p.ModifiedBy = string.IsNullOrEmpty(p.ModifiedBy) ? p.ModifiedBy : ApplyDisplayName(p.ModifiedBy, nameMap);
            }
            return all;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<ProducerDetails>();
        }
    }

    public async Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? scoularId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var saved = await _producerDetailsRepository.UpsertAsync(customerId, scoularId, customerName, totalAcres, binCapacity, primaryContact, commodities, linkedProducerIds, GetCurrentUser(), cancellationToken);

            var nameMap = await ResolveDisplayNamesAsync(
                new[] { saved.CreatedBy, saved.ModifiedBy ?? string.Empty }, cancellationToken);
            saved.CreatedBy = ApplyDisplayName(saved.CreatedBy, nameMap);
            saved.ModifiedBy = string.IsNullOrEmpty(saved.ModifiedBy) ? saved.ModifiedBy : ApplyDisplayName(saved.ModifiedBy, nameMap);
            return saved;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error upserting ProducerDetails for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteProducerDetailsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _producerDetailsRepository.DeleteAsync(customerId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting ProducerDetails for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Storage Operations — ctrm.vw_GNTA39D1 joined with originations.vw_CurrentCustomers
    // =========================================================================

    public async Task<List<StoredGrain>> GetStoredGrainAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default) =>
        await _storedGrainRepository.GetAsync(tradeUnits, cancellationToken);

    public async Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default) =>
        await _storedGrainRepository.GetByCustomerAsync(customerId, cancellationToken);

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public async Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var lists = await _savedListRepository.GetByUserAsync(GetCurrentUser(), cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                lists.Select(l => l.CreatedBy).Concat(lists.Select(l => l.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var l in lists)
            {
                l.CreatedBy = ApplyDisplayName(l.CreatedBy, nameMap);
                l.ModifiedBy = string.IsNullOrEmpty(l.ModifiedBy) ? l.ModifiedBy : ApplyDisplayName(l.ModifiedBy, nameMap);
            }
            return lists;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving saved lists [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<SavedList> SaveListAsync(string name, string query, string? tradeUnits, string? filters = null, string? includedCustomerIds = null, string? excludedCustomerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var savedList = new SavedList
            {
                Name = name,
                Query = query,
                TradeUnits = tradeUnits,
                Filters = filters,
                IncludedCustomerIds = includedCustomerIds,
                ExcludedCustomerIds = excludedCustomerIds,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };
            await _savedListRepository.AddAsync(savedList, cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(new[] { savedList.CreatedBy }, cancellationToken);
            savedList.CreatedBy = ApplyDisplayName(savedList.CreatedBy, nameMap);
            return savedList;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving list [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<SavedList?> UpdateListAsync(int listId, string name, string query, string? tradeUnits, string? filters = null, string? includedCustomerIds = null, string? excludedCustomerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var list = await _savedListRepository.UpdateAsync(listId, GetCurrentUser(), name, query, tradeUnits, filters, includedCustomerIds, excludedCustomerIds, cancellationToken);
            if (list == null) return null;
            var nameMap = await ResolveDisplayNamesAsync(
                new[] { list.CreatedBy, list.ModifiedBy ?? string.Empty }, cancellationToken);
            list.CreatedBy = ApplyDisplayName(list.CreatedBy, nameMap);
            list.ModifiedBy = string.IsNullOrEmpty(list.ModifiedBy) ? list.ModifiedBy : ApplyDisplayName(list.ModifiedBy, nameMap);
            return list;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating saved list {ListId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                listId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task DeleteListAsync(int listId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _savedListRepository.DeleteAsync(listId, GetCurrentUser(), cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting saved list {ListId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                listId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Dashboard Planting Estimate Operations
    // =========================================================================

    public async Task<DashboardSummaryResponse> GetDashboardSummaryAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        // EF Core DbContext is not thread-safe — run sequentially instead of Task.WhenAll.
        // These are small app tables (< 20ms each), so sequential is still far faster
        // than 3 separate HTTP round-trips from the client. Actual harvest is the prior year.
        var estimates = await _dashboardRepository.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken);
        var marketShares = await _dashboardRepository.GetMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken);
        var actualHarvest = await _dashboardRepository.GetActualHarvestAsync(tradeUnitKey, plantingYear - 1, cancellationToken);

        return new DashboardSummaryResponse
        {
            Estimates = estimates,
            MarketShares = marketShares,
            ActualHarvest = actualHarvest
        };
    }

    public Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default) =>
        _dashboardRepository.GetPlantingEstimatesAsync(tradeUnitKey, plantingYear, cancellationToken);

    public Task UpsertDashboardPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, string username, CancellationToken cancellationToken = default) =>
        _dashboardRepository.UpsertPlantingEstimatesAsync(
            estimates.Select(r => new DashboardPlantingEstimate
            {
                TradeUnitKey = r.TradeUnitKey,
                Crop = r.Crop,
                PlantingYear = r.PlantingYear,
                YieldEstimate = r.YieldEstimate
            }).ToList(),
            username, cancellationToken);

    public Task<List<DashboardMarketShare>> GetDashboardMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default) =>
        _dashboardRepository.GetMarketSharesAsync(tradeUnitKey, plantingYear, cancellationToken);

    public Task UpsertDashboardMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, string username, CancellationToken cancellationToken = default) =>
        _dashboardRepository.UpsertMarketSharesAsync(
            shares.Select(r => new DashboardMarketShare
            {
                TradeUnitKey = r.TradeUnitKey,
                CropCategory = r.CropCategory,
                PlantingYear = r.PlantingYear,
                MarketSharePct = r.MarketSharePct
            }).ToList(),
            username, cancellationToken);

    public Task<List<DashboardActualHarvest>> GetDashboardActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default) =>
        _dashboardRepository.GetActualHarvestAsync(tradeUnitKey, plantingYear, cancellationToken);

    public Task UpsertDashboardActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, string username, CancellationToken cancellationToken = default) =>
        _dashboardRepository.UpsertActualHarvestAsync(
            items.Select(r => new DashboardActualHarvest
            {
                TradeUnitKey = r.TradeUnitKey,
                CropCategory = r.CropCategory,
                PlantingYear = r.PlantingYear,
                Bushels = r.Bushels
            }).ToList(),
            username, cancellationToken);

    public Task DeleteDashboardActualHarvestAsync(int id, CancellationToken cancellationToken = default) =>
        _dashboardRepository.DeleteActualHarvestAsync(id, cancellationToken);

    // =========================================================================
    // Bid Sheet Operations
    // =========================================================================

    public async Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode = null, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"elevators:{tradeUnitCode ?? "all"}";
        if (_cache.TryGetValue(cacheKey, out List<ElevatorCache>? cached) && cached is not null)
            return cached;

        var result = await _bidSheetRepository.GetElevatorsAsync(tradeUnitCode, cancellationToken);
        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
            Size = 1
        });
        return result;
    }

    public Task<List<BidSheetLocation>> GetBidSheetLocationsAsync(string tradeUnitCode, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetLocationsAsync(tradeUnitCode, cancellationToken);

    public Task<List<BidSheetLocation>> GetAllBidSheetLocationsAsync(CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetAllLocationsAsync(cancellationToken);

    public Task<BidSheetLocation> CreateBidSheetLocationAsync(BidSheetLocation location, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.CreateLocationAsync(location, cancellationToken);

    public Task<BidSheetLocation?> UpdateBidSheetLocationAsync(int id, BidSheetLocation location, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.UpdateLocationAsync(id, location, cancellationToken);

    public Task DeleteBidSheetLocationAsync(int id, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.DeleteLocationAsync(id, cancellationToken);

    public Task DeleteBidSheetBidsAsync(int locationId, string commodityCode, int? month = null, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.DeleteBidsAsync(locationId, commodityCode, month, cancellationToken);

    public Task BulkUpsertBidSheetBidsAsync(
        IEnumerable<GrainOriginatorPortal.Api.Models.Requests.UpsertBidSheetBidRequest> requests,
        string tradeUnitCode,
        string userId,
        CancellationToken cancellationToken = default) =>
        _bidSheetRepository.BulkUpsertBidsAsync(
            requests.Select(r => new BidUpsertInput
            {
                Name = r.Name,
                ElevatorCode = r.ElevatorCode,
                GroupName = r.GroupName,
                Latitude = r.Latitude,
                Longitude = r.Longitude,
                CommodityCode = r.CommodityCode,
                CommodityName = r.CommodityName,
                CommodityCategory = r.CommodityCategory,
                CropYear = r.CropYear,
                Month = r.Month,
                Bid = r.Bid
            }),
            tradeUnitCode, userId, cancellationToken);

    public Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetBidCropYearsAsync(tradeUnitCode, cancellationToken);

    public Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetBidCommoditiesAsync(tradeUnitCode, cancellationToken);

    public Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetBidMonthsAsync(tradeUnitCode, cropYear, cancellationToken);

    // =========================================================================
    // Bid Sheet Location Order (drag-to-reorder persistence)
    // =========================================================================

    public Task<BidSheetLocationOrder?> GetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetLocationOrderAsync(userId, tradeUnitKey, cancellationToken);

    public Task SetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.SetLocationOrderAsync(userId, tradeUnitKey, locationOrderJson, cancellationToken);

    // =========================================================================
    // Bid Sheet Preferences (per-user per-TU UI preferences)
    // =========================================================================

    public Task<BidSheetPreference?> GetBidSheetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.GetPreferenceAsync(userId, tradeUnitKey, cancellationToken);

    public Task SetBidSheetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder = null, string? hiddenCrops = null, string? selectedMonths = null, string? printLayout = null, CancellationToken cancellationToken = default) =>
        _bidSheetRepository.SetPreferenceAsync(userId, tradeUnitKey, cropCode, month, cropYear, cropOrder, hiddenCrops, selectedMonths, printLayout, cancellationToken);

    // =========================================================================
    // Query Library Operations
    // =========================================================================

    public async Task<List<QueryLibraryItem>> GetQueryLibraryAsync(CancellationToken cancellationToken = default)
    {
        var items = await _queryLibraryRepository.GetActiveAsync(cancellationToken);
        return items as List<QueryLibraryItem> ?? items.ToList();
    }

    public async Task LogQuerySearchAsync(string searchText, int? matchedQueryId, CancellationToken cancellationToken = default)
    {
        // UserId + timestamp are request/business context, so the entity is built here and the
        // repository just persists it.
        await _queryLibraryRepository.AddSearchLogAsync(new QuerySearchLog
        {
            UserId = GetCurrentUser(),
            SearchText = searchText,
            MatchedQueryId = matchedQueryId,
            Timestamp = DateTime.UtcNow
        }, cancellationToken);
    }
}
