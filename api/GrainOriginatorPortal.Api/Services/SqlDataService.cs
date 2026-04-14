using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Middleware;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// SQL Server implementation of IDataService using Entity Framework Core.
/// Provides data access to Azure SQL Database with managed identity authentication.
/// </summary>
public class SqlDataService : IDataService
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<SqlDataService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IMemoryCache _cache;

    public SqlDataService(OriginationDbContext context, ApplicationDbContext appContext, ILogger<SqlDataService> logger, IHttpContextAccessor httpContextAccessor, IMemoryCache cache)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
        _cache = cache;
    }

    private string GetTraceId() =>
        _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
        ?? _httpContextAccessor.HttpContext?.TraceIdentifier
        ?? "no-trace";

    /// <summary>Sanitizes a list of ID strings for safe use in STRING_SPLIT CSV parameters.
    /// Strips any character that isn't alphanumeric, hyphen, or underscore.</summary>
    private static string SanitizeCsv(IEnumerable<string> values) =>
        string.Join(",", values.Select(v => System.Text.RegularExpressions.Regex.Replace(v, @"[^a-zA-Z0-9\-_]", "")));

    private string GetCurrentUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        return user?.FindFirst("name")?.Value
            ?? user?.FindFirst("preferred_username")?.Value
            ?? user?.FindFirst("oid")?.Value
            ?? user?.Identity?.Name
            ?? "System";
    }

    // =========================================================================
    // Customer Operations
    // =========================================================================

    public async Task<List<Customer>> GetCustomersAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;
            var filterMsg = hasTradeUnitFilter ? $" (filtered by {tradeUnits!.Count} trade units: {string.Join(", ", tradeUnits)})" : "";

            // --- PERF: SQL-side dedup via ROW_NUMBER so only one row per customer crosses the wire.
            // Previously pulled ALL snapshot rows (one per customer-trade-unit pair) into memory
            // and deduplicated with GroupBy in C#, transferring ~Nx the needed rows.
            // Old code:
            //   var query = _appContext.CustomerSnapshots.AsNoTracking().Where(s => s.IsActive);
            //   if (hasTradeUnitFilter)
            //       query = query.Where(s => s.TradeUnit != null && tradeUnits!.Contains(s.TradeUnit));
            //   var snapshots = await query.OrderBy(s => s.CustomerName).ToListAsync(cancellationToken);
            //   var customers = snapshots
            //       .GroupBy(s => s.CustomerId)
            //       .Select(g => MapSnapshotToCustomer(g.First()))
            //       .OrderBy(c => c.Name)   // <-- redundant sort (SQL already sorted)
            //       .ToList();
            //   await EnrichCustomersWithESignAsync(customers, cancellationToken);

            // Build WHERE clause and parameters for raw SQL dedup query
            var whereClauses = new List<string> { "IsActive = 1" };
            var parameters = new List<SqlParameter>();

            if (hasTradeUnitFilter)
            {
                var csv = SanitizeCsv(tradeUnits!);
                whereClauses.Add("TradeUnit IN (SELECT value FROM STRING_SPLIT(@tradeUnits, ','))");
                parameters.Add(new SqlParameter("@tradeUnits", csv));
            }

            var where = string.Join(" AND ", whereClauses);
            var sql = $@"
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY CustomerName) AS rn
                    FROM dbo.CustomerSnapshot
                    WHERE {where}
                ) t WHERE rn = 1
                ORDER BY CustomerName";

            // NOTE: Cannot parallelize customer + eSign queries via Task.WhenAll because
            // both use the same _appContext DbContext, and EF Core forbids concurrent operations
            // on a single DbContext instance. The SQL dedup + indexes are the main perf wins here.
            var snapshots = await _appContext.CustomerSnapshots
                .FromSqlRaw(sql, parameters.ToArray())
                .AsNoTracking()
                .ToListAsync(cancellationToken);

            var customers = snapshots.Select(MapSnapshotToCustomer).ToList();

            await EnrichCustomersWithESignAsync(customers, cancellationToken);
            _logger.LogInformation("Returning {Count} customers from CustomerSnapshot{Filter}", customers.Count, filterMsg);
            return customers;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "CustomerSnapshot table/column not found (SQL {Number}) — returning empty customer list [{TraceId}]",
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
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();

            if (searchWords.Count == 0)
                return [];

            // --- PERF: Raw SQL with ROW_NUMBER dedup (same approach as GetCustomersAsync).
            // Old code used EF LINQ Contains which generates LIKE '%word%' per column per word,
            // then pulled up to 1000 duplicate TU rows and deduped in C#.
            // New approach: single raw SQL query with dedup built in, returns max 200 unique customers.
            var whereClauses = new List<string> { "IsActive = 1" };
            var parameters = new List<SqlParameter>();

            if (hasTradeUnitFilter)
            {
                var csv = SanitizeCsv(tradeUnits!);
                whereClauses.Add("TradeUnit IN (SELECT value FROM STRING_SPLIT(@tradeUnits, ','))");
                parameters.Add(new SqlParameter("@tradeUnits", csv));
            }

            // Each search word must match at least one searchable field (AND across words).
            // State uses exact match to avoid false positives on short abbreviations like "CO".
            for (int i = 0; i < searchWords.Count; i++)
            {
                var paramName = $"@w{i}";
                var word = searchWords[i];
                parameters.Add(new SqlParameter(paramName, word));

                whereClauses.Add($@"(
                    CustomerName LIKE '%' + {paramName} + '%'
                    OR SourceCustomerId LIKE '%' + {paramName} + '%'
                    OR MerchandisingPhone LIKE '%' + {paramName} + '%'
                    OR ExtendedPrimaryPhone LIKE '%' + {paramName} + '%'
                    OR MerchandisingCity LIKE '%' + {paramName} + '%'
                    OR MerchandisingStateProvince = {paramName}
                    OR CustomerId IN (SELECT CustomerId FROM dbo.ProducerDetails WHERE PrimaryContact LIKE '%' + {paramName} + '%')
                )");
            }

            var where = string.Join(" AND ", whereClauses);
            var sql = $@"
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY CustomerId ORDER BY CustomerName) AS rn
                    FROM dbo.CustomerSnapshot
                    WHERE {where}
                ) t WHERE rn = 1";

            var snapshots = await _appContext.CustomerSnapshots
                .FromSqlRaw(sql, parameters.ToArray())
                .AsNoTracking()
                .ToListAsync(cancellationToken);

            var customers = snapshots.Select(MapSnapshotToCustomer).ToList();

            // Score by relevance so best matches appear first
            var scoredCustomers = customers.Select(c => new
            {
                Customer = c,
                Score = CalculateRelevanceScore(c.Name, searchWords, searchTerm)
            })
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.Customer.Name)
            .Select(x => x.Customer)
            .ToList();

            await EnrichCustomersWithESignAsync(scoredCustomers, cancellationToken);
            _logger.LogInformation("Search for '{SearchTerm}' returned {Count} customers from CustomerSnapshot", searchTerm, scoredCustomers.Count);
            return scoredCustomers;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "CustomerSnapshot table/column not found (SQL {Number}) — returning empty search results [{TraceId}]",
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
    /// Maps a CustomerSnapshot row to the Customer model used by the API.
    /// CustomerSnapshot stores one row per customer-trade unit pair; callers must deduplicate.
    /// </summary>
    private static Customer MapSnapshotToCustomer(CustomerSnapshot snap) => new()
    {
        Id = snap.CustomerId,
        Name = snap.CustomerName,
        SourceCustomerId = snap.SourceCustomerId?.Trim(),
        IndustryCode1 = snap.IndustryCode1,
        IsActive = snap.IsActive,
        EffectiveStartDate = snap.EffectiveStartDate,
        EffectiveEndDate = snap.EffectiveEndDate,
        Phone = snap.MerchandisingPhone,
        Email = snap.MerchandisingEmail,
        ExtendedPrimaryPhone = snap.ExtendedPrimaryPhone,
        SupplementalEmail = snap.SupplementalEmail,
        Location = snap.MerchandisingCity,
        StateProvince = snap.MerchandisingStateProvince,
        AddressLine1 = snap.MerchandisingAddressLine1,
        PostalCode = snap.MerchandisingPostalCode,
        ExtendedAddressLine1 = snap.ExtendedAddressLine1,
        ExtendedAddressLine2 = snap.ExtendedAddressLine2,
        ExtendedAddressLine3 = snap.ExtendedAddressLine3,
        ExtendedAddressLine4 = snap.ExtendedAddressLine4,
        ExtendedCity = snap.ExtendedCity,
        ExtendedPostalCode = snap.ExtendedPostalCode,
        ExtendedStateProvince = snap.ExtendedStateProvince,
        ExtendedCountry = snap.ExtendedCountry,
    };

    /// <summary>
    /// Looks up eSign enrollment records for the given customers and populates
    /// ESignEnabled and ScoularViewRecipients from dbo.eSignEnrollment.
    /// Async version — queries the DB. Used by callers that don't pre-fetch eSign data.
    /// </summary>
    private async Task EnrichCustomersWithESignAsync(List<Customer> customers, CancellationToken cancellationToken = default)
    {
        if (customers.Count == 0) return;

        var codes = customers
            .Where(c => c.SourceCustomerId != null)
            .Select(c => c.SourceCustomerId!)
            .Distinct()
            .ToList();

        // Presence in table = enrolled (table only contains eSign customers).
        var enrollmentList = await _appContext.ESignEnrollments
            .AsNoTracking()
            .Where(e => codes.Contains(e.CustomerCode))
            .ToListAsync(cancellationToken);

        EnrichCustomersWithESign(customers, enrollmentList);
    }

    /// <summary>
    /// Enriches customers with eSign data from an already-loaded enrollment list.
    /// Used by GetCustomersAsync/SearchCustomersAsync which pre-fetch eSign in parallel.
    /// </summary>
    private static void EnrichCustomersWithESign(List<Customer> customers, List<ESignEnrollment> enrollmentList)
    {
        if (customers.Count == 0) return;

        // For duplicates: find the first row with real ScoularViewRecipients
        // (not null, empty, or "No"). If none have recipients, value stays null.
        var enrollments = enrollmentList
            .GroupBy(e => e.CustomerCode)
            .ToDictionary(
                g => g.Key,
                g => g.FirstOrDefault(e =>
                    !string.IsNullOrWhiteSpace(e.ScoularViewRecipients) &&
                    !e.ScoularViewRecipients!.Equals("No", StringComparison.OrdinalIgnoreCase)
                )?.ScoularViewRecipients);

        foreach (var customer in customers)
        {
            if (customer.SourceCustomerId != null &&
                enrollments.TryGetValue(customer.SourceCustomerId, out var recipients))
            {
                customer.ESignEnabled = true;
                customer.ScoularViewRecipients = recipients;
            }
        }
    }

    /// <summary>
    /// Calculates a relevance score for a customer name based on how well it matches the search terms.
    /// Higher scores indicate better matches.
    /// </summary>
    private int CalculateRelevanceScore(string customerName, List<string> searchWords, string originalSearchTerm)
    {
        var score = 0;
        var nameUpper = customerName.ToUpper();
        var searchTermUpper = originalSearchTerm.ToUpper();

        // Boost 1: Exact match (very rare but highest priority)
        if (nameUpper == searchTermUpper)
        {
            score += 10000;
            return score; // Perfect match, no need for other checks
        }

        // Boost 2: Name starts with search term (e.g., "JIM" matches "JIM JOHNSON")
        if (nameUpper.StartsWith(searchTermUpper))
        {
            score += 5000;
        }

        // Boost 3: Search term appears as contiguous substring (e.g., "Jim Johnson" in "Johnson, Jim R")
        if (nameUpper.Contains(searchTermUpper.Replace(",", "").Replace("  ", " ")))
        {
            score += 3000;
        }

        // Boost 4: All search words appear in the same order they were typed
        var lastIndex = -1;
        var inOrder = true;
        foreach (var word in searchWords)
        {
            var index = nameUpper.IndexOf(word.ToUpper(), lastIndex + 1);
            if (index <= lastIndex)
            {
                inOrder = false;
                break;
            }
            lastIndex = index;
        }
        if (inOrder)
        {
            score += 2000;
        }

        // Boost 5: Fewer total words in name (more specific matches rank higher)
        // "Johnson, Jim R" (3 words) should rank higher than "JIM JOHNSON - PROJECT 17" (5 words)
        var nameWords = customerName.Split(new[] { ' ', ',', '-' }, StringSplitOptions.RemoveEmptyEntries).Length;
        score += Math.Max(0, 100 - (nameWords * 10)); // Penalize longer names

        // Boost 6: Each search word that appears early in the name
        foreach (var word in searchWords)
        {
            var index = nameUpper.IndexOf(word.ToUpper());
            if (index >= 0)
            {
                // Earlier positions get higher scores (max 100 for position 0, decreasing)
                score += Math.Max(0, 100 - index);
            }
        }

        // Boost 7: Proportion of search words to total name words (coverage)
        // If search has 3 words and name has 3 words, that's 100% coverage (better than 3 words in a 5-word name)
        var coverage = (double)searchWords.Count / nameWords;
        score += (int)(coverage * 500);

        return score;
    }

    public async Task<Customer?> GetCustomerByIdAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && c.IsActive, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                id, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<Customer?> GetCustomerBySourceIdAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _context.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.SourceCustomerId == sourceCustomerId && c.IsActive, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving customer by source ID {SourceCustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                sourceCustomerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task UpdateCustomerAsync(long customerId, string location, string phone, string email, List<string> farmIds, List<string> linkedProducerIds, CancellationToken cancellationToken = default)
    {
        try
        {
            var customer = await _context.Customers.FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
            if (customer == null)
            {
                _logger.LogWarning("Customer {CustomerId} not found for update", customerId);
                return;
            }

            customer.Location = location;
            customer.Phone = phone;
            customer.Email = email;
            customer.FarmIds = farmIds;
            customer.LinkedProducerIds = linkedProducerIds;

            // Recalculate TotalAcres based on associated farms
            // Note: Farms table doesn't exist in ODS - skipping TotalAcres calculation
            // customer.TotalAcres = _context.Farms
            //     .Where(f => farmIds.Contains(f.Id))
            //     .Sum(f => f.Acres);
            customer.TotalAcres = 0;

            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Updated customer {CustomerId}", customerId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Trade Unit Operations
    // =========================================================================

    public async Task<List<string>> GetTradeUnitsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var cachedTradeUnits = await _appContext.TradeUnits
                .Where(tu => tu.IsActive)
                .Select(tu => tu.Code)
                .OrderBy(c => c)
                .ToListAsync(cancellationToken);

            if (cachedTradeUnits.Count > 0)
            {
                _logger.LogInformation("Returning {Count} trade units from dbo.TradeUnits", cachedTradeUnits.Count);
                return cachedTradeUnits;
            }

            // Table is empty - one-time population from ODS
            _logger.LogInformation("dbo.TradeUnits is empty - performing one-time population from ODS");
            var tradeUnitsFromOds = await GetTradeUnitsFromViewsAsync(cancellationToken);

            foreach (var code in tradeUnitsFromOds)
            {
                _appContext.TradeUnits.Add(new TradeUnit { Code = code, IsActive = true });
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            return tradeUnitsFromOds;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade units [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    private async Task<List<string>> GetTradeUnitsFromViewsAsync(CancellationToken cancellationToken = default)
    {
        // Get unique trade units from contracts
        var contractTradeUnits = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && c.ContractPrefixType == "P" && !string.IsNullOrEmpty(c.TradeUnit))
            .Select(c => c.TradeUnit!)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Get unique organization codes from tickets
        var ticketOrgCodes = await _context.Tickets
            .AsNoTracking()
            .Where(t => t.IsActive && (t.TicketType == "U" || t.TicketType == "P") && !string.IsNullOrEmpty(t.OrganizationCode))
            .Select(t => t.OrganizationCode!)
            .Distinct()
            .ToListAsync(cancellationToken);

        // Combine and return unique sorted list
        var allTradeUnits = contractTradeUnits
            .Union(ticketOrgCodes)
            .OrderBy(tu => tu)
            .ToList();

        return allTradeUnits;
    }

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
            var result = await _appContext.Commodities
                .AsNoTracking()
                .Where(c => c.IsActive)
                .OrderBy(c => c.Name)
                .ToListAsync(cancellationToken);

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

    public async Task<List<CommodityConversion>> GetCommodityConversionsAsync(CancellationToken cancellationToken = default)
    {
        const string cacheKey = "commodity-conversions";
        if (_cache.TryGetValue(cacheKey, out List<CommodityConversion>? cached) && cached is not null)
            return cached;

        var result = await _context.CommodityConversions
            .AsNoTracking()
            .Where(c => c.LbsPerUnit > 0)
            .ToListAsync(cancellationToken);

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

        var result = await _appContext.HarvestWindows
            .AsNoTracking()
            .Where(h => h.IsActive)
            .ToListAsync(cancellationToken);

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
            var existingCodesList = await _appContext.Commodities
                .Where(c => c.IsActive)
                .Select(c => c.Code)
                .ToListAsync(cancellationToken);

            var existingCodes = new HashSet<string>(existingCodesList, StringComparer.OrdinalIgnoreCase);

            // Pull all commodity data from contracts (Code, Name, Category)
            var contractCommodities = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P"
                    && !string.IsNullOrEmpty(c.CommodityCode)
                    && !string.IsNullOrEmpty(c.CommodityDescription))
                .Select(c => new { c.CommodityCode, c.CommodityDescription, c.CommodityGroup })
                .Distinct()
                .ToListAsync(cancellationToken);

            // Pull all distinct product codes from tickets
            var ticketProductCodes = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && (t.TicketType == "U" || t.TicketType == "P") && !string.IsNullOrEmpty(t.ProductCode))
                .Select(t => t.ProductCode!)
                .Distinct()
                .ToListAsync(cancellationToken);

            // Build lookup from contracts for description and category
            var contractLookup = contractCommodities
                .GroupBy(c => c.CommodityCode!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            bool changed = false;

            // Add any contract commodities not yet in the table
            foreach (var item in contractCommodities)
            {
                if (!existingCodes.Contains(item.CommodityCode!))
                {
                    _appContext.Commodities.Add(new Commodity
                    {
                        Code = item.CommodityCode!,
                        Name = item.CommodityDescription!,
                        Category = item.CommodityGroup,
                        IsActive = true
                    });
                    existingCodes.Add(item.CommodityCode!);
                    changed = true;
                }
            }

            // Add any ticket product codes not already covered by contracts
            foreach (var productCode in ticketProductCodes)
            {
                if (!existingCodes.Contains(productCode))
                {
                    contractLookup.TryGetValue(productCode, out var match);
                    _appContext.Commodities.Add(new Commodity
                    {
                        Code = productCode,
                        Name = match?.CommodityDescription ?? productCode,
                        Category = match?.CommodityGroup,
                        IsActive = true
                    });
                    existingCodes.Add(productCode);
                    changed = true;
                }
            }

            // Backfill Category for any commodities missing it
            var allCommodities = await _appContext.Commodities.Where(c => c.IsActive).ToListAsync(cancellationToken);
            foreach (var commodity in allCommodities.Where(c => string.IsNullOrEmpty(c.Category)))
            {
                if (contractLookup.TryGetValue(commodity.Code, out var match)
                    && !string.IsNullOrEmpty(match.CommodityGroup))
                {
                    commodity.Category = match.CommodityGroup;
                    changed = true;
                }
            }

            if (changed)
            {
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Synced commodities from ODS - now {Count} total", allCommodities.Count);
            }
            else
            {
                _logger.LogInformation("Commodity sync complete - no changes ({Count} total)", allCommodities.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing commodities [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            // Don't throw — sync failure shouldn't prevent app startup
        }
    }

    public async Task<List<TradeUnitGroup>> GetTradeUnitGroupsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var groups = await _appContext.TradeUnitGroups
                .AsNoTracking()
                .Where(g => g.IsActive)
                .Include(g => g.TradeUnits.Where(tu => tu.IsActive))
                .OrderBy(g => g.GroupName)
                .ToListAsync(cancellationToken);

            _logger.LogInformation("Returning {Count} trade unit groups", groups.Count);
            return groups;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving trade unit groups [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    // =========================================================================
    // Farm Operations - DISABLED: Farms table doesn't exist in ODS
    // =========================================================================

    public Task<List<Farm>> GetFarmsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list");
        return Task.FromResult(new List<Farm>());
    }

    public Task<List<Farm>> GetFarmsByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning empty list for customer {CustomerId}", customerId);
        return Task.FromResult(new List<Farm>());
    }

    public Task<Farm?> GetFarmByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - returning null for farm {FarmId}", id);
        return Task.FromResult<Farm?>(null);
    }

    public Task<string> CreateFarmAsync(string name, string location, int acres, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("Farms table doesn't exist in ODS - cannot create farm {FarmName}", name);
        throw new NotImplementedException("Farm creation is not supported - Farms table doesn't exist in ODS");
    }

    // =========================================================================
    // Contract Operations
    // =========================================================================

    public async Task<List<Contract>> GetContractsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Two-path strategy. Both paths now use STRING_SPLIT downstream so we never hit
            // SQL Server's 2100-parameter IN-clause limit even when the unfiltered path returns
            // thousands of producer IDs.
            List<Contract> contracts;

            if (!hasTradeUnitFilter)
            {
                // Unfiltered: every active producer in CustomerSnapshot. Trade unit selection is a
                // narrowing convenience, not an entitlement boundary — when nothing is selected
                // the user can search across the full producer base.
                var customerCtrmIds = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null)
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                if (customerCtrmIds.Count == 0)
                {
                    contracts = [];
                }
                else
                {
                    var ctrmIdsCsv = SanitizeCsv(customerCtrmIds);
                    contracts = await _context.Contracts
                        .FromSqlInterpolated($@"
                            SELECT c.* FROM base.vw_CurrentContracts c
                            INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                                ON c.CtrmCustomerId = ids.value
                            WHERE c.IsActive = 1 AND c.ContractPrefixType = 'P'
                              AND (c.ClosedDate IS NULL OR c.CropYear >= {DateTime.Today.Year - 1})")
                        .AsNoTracking()
                        .OrderByDescending(c => c.Id)
                        .ToListAsync(cancellationToken);
                }
            }
            else
            {
                // Step 1: get producer customer IDs from CustomerSnapshot (app DB, fast indexed lookup).
                // CustomerSnapshot already contains only producer customers — no additional type filter needed.
                var ctrmIds = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(c => c.SourceCustomerId != null && c.IsActive
                        && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                if (ctrmIds.Count == 0)
                {
                    contracts = [];
                }
                else
                {
                    // Step 2: load contracts for those producer customers.
                    // STRING_SPLIT passes IDs as a single CSV parameter instead of 200+ individual
                    // parameters — avoids the slow IN-clause plan on vw_CurrentContracts where
                    // CtrmCustomerId has no index.
                    var ctrmIdsCsv = SanitizeCsv(ctrmIds);
                    contracts = await _context.Contracts
                        .FromSqlInterpolated($@"
                            SELECT c.* FROM base.vw_CurrentContracts c
                            INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                                ON c.CtrmCustomerId = ids.value
                            WHERE c.IsActive = 1 AND c.ContractPrefixType = 'P'
                              AND (c.ClosedDate IS NULL OR c.CropYear >= {DateTime.Today.Year - 1})")
                        .AsNoTracking()
                        .OrderByDescending(c => c.Id)
                        .ToListAsync(cancellationToken);
                }
            }

            _logger.LogInformation("Loaded {ContractCount} contracts for customers who have contracts or tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
                contracts.Count, hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            return contracts;
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

    private ContractStatus CalculateContractStatus(Contract contract, DateTime today)
    {
        // NOTE: Fulfilled status requires ticket data to calculate delivery progress
        // Once tickets are available, check if 100% delivered and return Fulfilled

        // Check delivery period dates
        if (contract.DeliveryStart.HasValue && contract.DeliveryEnd.HasValue)
        {
            // If today is before delivery period starts, it's pending
            if (today < contract.DeliveryStart.Value)
            {
                return ContractStatus.Pending;
            }

            // If today is within the delivery period, it's active
            if (today >= contract.DeliveryStart.Value && today <= contract.DeliveryEnd.Value)
            {
                return ContractStatus.Active;
            }

            // If delivery period has passed, it's overdue (until we can verify fulfillment via tickets)
            if (today > contract.DeliveryEnd.Value)
            {
                return ContractStatus.Overdue;
            }
        }

        // Default to pending for contracts without delivery dates
        return ContractStatus.Pending;
    }

    public async Task<List<Contract>> GetContractsByCustomerAsync(long customerId, string? sourceCustomerId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Resolve SourceCustomerId if not supplied by the caller (avoids a DB round-trip when the client already has it).
            if (string.IsNullOrEmpty(sourceCustomerId))
            {
                var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
                if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
                {
                    _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                    return [];
                }
                sourceCustomerId = customer.SourceCustomerId;
            }

            // Match contracts: open contracts + prior-year (for pacing comparison)
            var pacingCutoffYear = DateTime.Today.Year - 1;
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId == sourceCustomerId
                    && (c.ClosedDate == null || c.CropYear >= pacingCutoffYear))
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            _logger.LogInformation("Found {ContractCount} contracts for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})",
                contracts.Count, customerId, sourceCustomerId);
            return contracts;
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
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
            if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId — returning empty historical contracts", customerId);
                return [];
            }

            var pacingCutoffYear = DateTime.Today.Year - 1;
            var contracts = await _context.Contracts
                .FromSqlInterpolated($@"
                    SELECT c.* FROM base.Contract c
                    WHERE c.IsActive = 1
                      AND c.IsDeleted = 0
                      AND c.ContractPrefixType = 'P'
                      AND c.CtrmCustomerId = {customer.SourceCustomerId}
                      AND c.ClosedDate IS NOT NULL
                      AND c.CropYear >= {pacingCutoffYear}")
                .AsNoTracking()
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true;
            }

            _logger.LogInformation("Loaded {Count} historical closed contracts for pacing (customer {CustomerId}, cutoff {Cutoff})",
                contracts.Count, customerId, pacingCutoffYear);
            return contracts;
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
            // Resolve producer CtrmCustomerIds from CustomerSnapshot. Trade unit selection is a
            // narrowing convenience, not an entitlement boundary — when nothing is selected we
            // return contracts for every active producer.
            var ctrmIdsQuery = _appContext.CustomerSnapshots
                .AsNoTracking()
                .Where(s => s.IsActive && s.SourceCustomerId != null);
            if (tradeUnits != null && tradeUnits.Count > 0)
            {
                ctrmIdsQuery = ctrmIdsQuery.Where(s => s.TradeUnit != null && tradeUnits.Contains(s.TradeUnit));
            }
            var ctrmIds = await ctrmIdsQuery
                .Select(s => s.SourceCustomerId!)
                .Distinct()
                .ToListAsync(cancellationToken);

            if (ctrmIds.Count == 0) return [];

            var ctrmIdsCsv = SanitizeCsv(ctrmIds);
            var contracts = await _context.Contracts
                .FromSqlInterpolated($@"
                    SELECT c.* FROM base.Contract c
                    INNER JOIN STRING_SPLIT({ctrmIdsCsv}, ',') ids
                        ON c.CtrmCustomerId = ids.value
                    WHERE c.IsActive = 1
                      AND c.IsDeleted = 0
                      AND c.ContractPrefixType = 'P'
                      AND c.CropYear = {cropYear}")
                .AsNoTracking()
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true;
            }

            _logger.LogInformation("Loaded {Count} base.Contract rows for crop year {CropYear} (tradeUnitCount: {TuCount})",
                contracts.Count, cropYear, tradeUnits?.Count ?? 0);
            return contracts;
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
            // Note: FarmId is not mapped in the current DbContext configuration
            // Returning empty list until proper mapping is established
            _logger.LogWarning("Contract.FarmId is not mapped - returning empty list for farm {FarmId}", farmId);
            return new List<Contract>();
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
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.SourceContractId == sourceContractId && c.ContractPrefixType == "P")
                .ToListAsync(cancellationToken);

            var today = DateTime.Today;
            foreach (var contract in contracts)
                contract.Status = CalculateContractStatus(contract, today);

            return contracts;
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
            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => p.ContractId == sourceContractId)
                .OrderBy(p => p.PriceSequence)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for contract {ContractId}. Returning empty list. Error: {Error}", sourceContractId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string sourceCustomerId, CancellationToken cancellationToken = default)
    {
        try
        {
            // base.vw_ContractPricing has no customer_id column — resolve via contracts
            var sourceContractIds = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.CtrmCustomerId == sourceCustomerId && c.ContractPrefixType == "P")
                .Select(c => c.SourceContractId)
                .Where(id => id != null)
                .ToListAsync(cancellationToken);

            if (sourceContractIds.Count == 0)
                return new List<ContractPricingLine>();

            return await _context.ContractPricingLines
                .AsNoTracking()
                .Where(p => sourceContractIds.Contains(p.ContractId))
                .OrderBy(p => p.ContractId)
                .ThenBy(p => p.PriceSequence)
                .ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("vw_ContractPricing not accessible for customer {CustomerId}. Returning empty list. Error: {Error}", sourceCustomerId, ex.Message);
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
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Two-path strategy. Both paths use STRING_SPLIT downstream to avoid SQL Server's
            // 2100-parameter IN-clause limit when the producer set is large.
            List<Ticket> tickets;

            if (!hasTradeUnitFilter)
            {
                // Unfiltered: every active producer in CustomerSnapshot. Trade unit selection is
                // a narrowing convenience, not an entitlement boundary.
                var customerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null)
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                if (customerCodes.Count == 0)
                {
                    tickets = [];
                }
                else
                {
                    var codesCsv = SanitizeCsv(customerCodes);
                    tickets = await _context.Tickets
                        .FromSqlInterpolated($@"
                            SELECT t.* FROM base.vw_CurrentTickets t
                            INNER JOIN STRING_SPLIT({codesCsv}, ',') ids
                                ON t.CustomerCode = ids.value
                            WHERE t.IsActive = 1 AND t.TicketType IN ('U','P')")
                        .AsNoTracking()
                        .OrderByDescending(t => t.Date)
                        .ToListAsync(cancellationToken);
                }
            }
            else
            {
                // Step 1: Find customer codes from TU contracts (purchase only) and TU snapshot
                var contractCustomerCodes = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                        && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var snapshotCustomerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null
                        && s.TradeUnit != null && tradeUnits!.Contains(s.TradeUnit))
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var customerCodes = contractCustomerCodes.Union(snapshotCustomerCodes).ToList();

                // Step 2: Get ALL contract numbers for these customers (cross-TU) so applied
                // tickets from any TU are included if they match a loaded contract.
                var allContractNumbers = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null && customerCodes.Contains(c.CtrmCustomerId)
                        && c.SourceContractId != null)
                    .Select(c => c.SourceContractId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);
                var contractNumberSet = allContractNumbers.ToHashSet();

                // Step 3: Load all tickets for these customers
                var rawTickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && (t.TicketType == "U" || t.TicketType == "P") && t.CustomerCode != null && customerCodes.Contains(t.CustomerCode))
                    .OrderByDescending(t => t.Date)
                    .ToListAsync(cancellationToken);

                // Keep unapplied tickets + applied tickets that match ANY contract for these customers
                tickets = rawTickets
                    .Where(t => !t.IsApplied || contractNumberSet.Contains(t.CtrmContractNumber!))
                    .ToList();
            }

            _logger.LogInformation("Loading tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
                hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

            // Load quality data in a single query using a server-side join on ticket IDs
            var ticketIds = tickets.Select(t => t.Id);
            var qualityData = await _context.TicketQualities
                .AsNoTracking()
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToDictionaryAsync(q => q.TicketId, cancellationToken);

            // Populate moisture and quality data on tickets
            var ticketsWithProtein = 0;
            var wheatTickets = 0;
            foreach (var ticket in tickets)
            {
                if (qualityData.TryGetValue(ticket.Id, out var quality))
                {
                    ticket.Moisture = quality.GradeFactorMoisturePercent;
                    ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                    ticket.ProteinPercent = quality.GradeFactorProteinPercent;

                    if (ticket.ProteinPercent.HasValue)
                        ticketsWithProtein++;
                }

                if ((ticket.ProductCode ?? "").ToLower().Contains("wheat"))
                    wheatTickets++;
            }

            _logger.LogInformation("Quality data: {TicketsWithProtein} tickets have protein data, {WheatTickets} wheat tickets found",
                ticketsWithProtein, wheatTickets);

            // Populate elevator city/state from ElevatorCache lookup
            await PopulateElevatorLocations(tickets, cancellationToken);

            // Log diagnostic info about ticket-contract relationships
            var ticketsWithContractId = tickets.Count(t => t.ContractId.HasValue);
            var ticketsWithContractNumber = tickets.Count(t => !string.IsNullOrEmpty(t.CtrmContractNumber));
            var ticketsWithBoth = tickets.Count(t => t.ContractId.HasValue && !string.IsNullOrEmpty(t.CtrmContractNumber));

            _logger.LogInformation("Loaded {TicketCount} tickets — {WithContractId} have ContractId, {WithContractNumber} have CtrmContractNumber, {WithBoth} have both",
                tickets.Count, ticketsWithContractId, ticketsWithContractNumber, ticketsWithBoth);

            return tickets;
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

    private async Task PopulateElevatorLocations(List<Ticket> tickets, CancellationToken cancellationToken)
    {
        // Collect unique (ElevatorCode, UnloadOrganizationCode) pairs from tickets
        var elevatorCodes = tickets
            .Where(t => !string.IsNullOrEmpty(t.ElevatorCode))
            .Select(t => t.ElevatorCode!)
            .Distinct()
            .ToList();
        if (elevatorCodes.Count == 0) return;

        try
        {
            // Load matching elevators from vw_GNP026
            // Join: ticket.ElevatorCode = Elevator_Code AND ticket.UnloadOrganizationCode = Elevator_Location_Code
            var elevatorList = await _context.Set<Elevator>()
                .AsNoTracking()
                .Where(e => e.ElevatorCode != null && elevatorCodes.Contains(e.ElevatorCode))
                .ToListAsync(cancellationToken);

            // Build lookup keyed by (ElevatorCode, ElevatorLocationCode) for precise matching
            var elevatorLookup = new Dictionary<string, Elevator>();
            foreach (var e in elevatorList)
            {
                if (e.ElevatorCode == null) continue;
                var compositeKey = $"{e.ElevatorCode.Trim()}|{(e.ElevatorLocationCode ?? "").Trim()}";
                if (!elevatorLookup.ContainsKey(compositeKey))
                    elevatorLookup[compositeKey] = e;
                // Also store by ElevatorCode alone as fallback
                if (!elevatorLookup.ContainsKey(e.ElevatorCode.Trim()))
                    elevatorLookup[e.ElevatorCode.Trim()] = e;
            }

            foreach (var ticket in tickets)
            {
                if (string.IsNullOrEmpty(ticket.ElevatorCode)) continue;
                var code = ticket.ElevatorCode.Trim();
                var locCode = (ticket.UnloadOrganizationCode ?? "").Trim();

                // Try precise match first (ElevatorCode + LocationCode), then fallback to ElevatorCode only
                if (elevatorLookup.TryGetValue($"{code}|{locCode}", out var elev)
                    || elevatorLookup.TryGetValue(code, out elev))
                {
                    ticket.ElevatorCity = elev.City?.Trim();
                    ticket.ElevatorState = elev.State?.Trim();
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Elevator lookup from vw_GNP026 failed — tickets will load without location data [{TraceId}]", GetTraceId());
        }
    }

    public async Task<List<Ticket>> GetTodaysTicketsAsync(List<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        var cutoffStr = DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-dd");
        var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

        try
        {
            List<Ticket> tickets;

            if (!hasTradeUnitFilter)
            {
                // Unfiltered: every active producer in CustomerSnapshot. Trade unit selection is
                // a narrowing convenience, not an entitlement boundary.
                var customerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null)
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                if (customerCodes.Count == 0)
                {
                    tickets = [];
                }
                else
                {
                    var codesCsv = SanitizeCsv(customerCodes);
                    tickets = await _context.Tickets
                        .FromSqlInterpolated($@"
                            SELECT t.* FROM base.vw_CurrentTickets t
                            INNER JOIN STRING_SPLIT({codesCsv}, ',') ids
                                ON t.CustomerCode = ids.value
                            WHERE t.IsActive = 1 AND t.TicketType IN ('U','P')
                              AND t.[Date] IS NOT NULL AND t.[Date] >= {cutoffStr}")
                        .AsNoTracking()
                        .OrderByDescending(t => t.Date)
                        .ToListAsync(cancellationToken);
                }
            }
            else
            {
                var tuContracts = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                        && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => new { c.CtrmCustomerId, c.SourceContractId })
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var contractCustomerCodes = tuContracts.Select(c => c.CtrmCustomerId!).ToHashSet();
                var tuContractNumbers = tuContracts
                    .Select(c => c.SourceContractId)
                    .Where(n => n != null)
                    .ToHashSet();

                var snapshotCustomerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null
                        && s.TradeUnit != null && tradeUnits!.Contains(s.TradeUnit))
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var customerCodes = contractCustomerCodes.Union(snapshotCustomerCodes).ToList();

                var rawTickets = await _context.Tickets
                    .AsNoTracking()
                    .Where(t => t.IsActive && (t.TicketType == "U" || t.TicketType == "P") && t.CustomerCode != null && customerCodes.Contains(t.CustomerCode) && t.Date != null && string.Compare(t.Date, cutoffStr) >= 0)
                    .OrderByDescending(t => t.Date)
                    .ToListAsync(cancellationToken);

                tickets = rawTickets
                    .Where(t => !t.IsApplied || tuContractNumbers.Contains(t.CtrmContractNumber!))
                    .ToList();
            }

            _logger.LogInformation("Loaded {TicketCount} recent tickets for spot loads (filtered: {IsFiltered}, cutoff: {CutoffStr})",
                tickets.Count, hasTradeUnitFilter, cutoffStr);

            // Load quality data
            var ticketIds = tickets.Select(t => t.Id);
            var qualityData = await _context.TicketQualities
                .AsNoTracking()
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToDictionaryAsync(q => q.TicketId, cancellationToken);

            foreach (var ticket in tickets)
            {
                if (qualityData.TryGetValue(ticket.Id, out var quality))
                {
                    ticket.Moisture = quality.GradeFactorMoisturePercent;
                    ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                    ticket.ProteinPercent = quality.GradeFactorProteinPercent;
                }
            }

            await PopulateElevatorLocations(tickets, cancellationToken);

            return tickets;
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

    public async Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, string? sourceCustomerId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Resolve SourceCustomerId if not supplied by the caller (avoids a DB round-trip when the client already has it).
            if (string.IsNullOrEmpty(sourceCustomerId))
            {
                var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId && c.IsActive, cancellationToken);
                if (customer == null || string.IsNullOrEmpty(customer.SourceCustomerId))
                {
                    _logger.LogWarning("Customer {CustomerId} not found or has no SourceCustomerId", customerId);
                    return [];
                }
                sourceCustomerId = customer.SourceCustomerId;
            }

            // Match tickets using CustomerCode = sourceCustomerId (string matching, like contracts)
            var tickets = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive && (t.TicketType == "U" || t.TicketType == "P") && t.CustomerCode == sourceCustomerId)
                .OrderByDescending(t => t.Date)
                .ToListAsync(cancellationToken);

            // Load quality data for these tickets
            var ticketIds = tickets.Select(t => t.Id).ToList();
            var qualityList = await _context.TicketQualities
                .AsNoTracking()
                .Where(q => ticketIds.Contains(q.TicketId))
                .ToListAsync(cancellationToken);

            var qualityData = qualityList.ToDictionary(q => q.TicketId);

            // Populate moisture and quality data on tickets
            foreach (var ticket in tickets)
            {
                if (qualityData.TryGetValue(ticket.Id, out var quality))
                {
                    ticket.Moisture = quality.GradeFactorMoisturePercent;
                    ticket.TestWeight = quality.GradeFactorTestWeightPercent;
                    ticket.ProteinPercent = quality.GradeFactorProteinPercent;
                }
            }

            await PopulateElevatorLocations(tickets, cancellationToken);

            _logger.LogInformation("Found {TicketCount} tickets for customer {CustomerId} (SourceCustomerId: {SourceCustomerId})",
                tickets.Count, customerId, sourceCustomerId);
            return tickets;
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

    public async Task<List<Ticket>> GetTicketsByFarmAsync(string farmId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Note: FarmId is not in ODS tickets view - cannot filter by farm
            _logger.LogWarning("Ticket.FarmId is not mapped in ODS - returning empty list for farm {FarmId}", farmId);
            return new List<Ticket>();
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
            var query = _appContext.PlantingIntentions.AsNoTracking();
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                // Find customer codes from TU contracts + snapshot, then load ALL their planting
                var contractCustomerCodes = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                             && c.TradeUnit != null && tuList.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var snapshotCustomerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null
                        && s.TradeUnit != null && tuList.Contains(s.TradeUnit))
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var customerCodes = contractCustomerCodes.Union(snapshotCustomerCodes).ToList();
                query = query.Where(p => customerCodes.Contains(p.CustomerCode));
            }
            if (plantingYear.HasValue)
            {
                query = query.Where(p => p.PlantingYear == plantingYear.Value);
            }
            var results = await query
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.CustomerName)
                .ToListAsync(cancellationToken);
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
            return await _appContext.PlantingIntentions
                .AsNoTracking()
                .Where(p => p.CustomerId == customerId)
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Crop)
                .ToListAsync(cancellationToken);
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

    public async Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default)
        => await _appContext.PlantingIntentions.AsNoTracking().FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);

    public async Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = new PlantingIntention
            {
                CustomerId = customerId,
                CustomerName = customerName,
                CustomerCode = customerCode,
                TradeUnit = tradeUnit,
                Crop = crop,
                Type = type,
                Description = description,
                Acres = acres,
                PlantingYear = plantingYear,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };

            _appContext.PlantingIntentions.Add(intention);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Created planting intention {Id} for customer {CustomerId}", intention.Id, customerId);
            return intention;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating planting intention for customer {CustomerId} [{TraceId}] [{ErrorCode}] [{ErrorCategory}]",
                customerId, GetTraceId(), "INFRASTRUCTURE_DATABASE_ERROR", "Infrastructure");
            throw;
        }
    }

    public async Task<PlantingIntention?> UpdatePlantingIntentionAsync(int intentionId, string crop, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
            if (intention == null)
            {
                return null;
            }

            intention.Crop = crop;
            intention.Type = type;
            intention.Description = description;
            intention.Acres = acres;
            intention.PlantingYear = plantingYear;
            intention.ModifiedBy = GetCurrentUser();
            intention.ModifiedAt = DateTime.UtcNow;

            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated planting intention {Id}", intentionId);
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
            var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
            if (intention != null)
            {
                _appContext.PlantingIntentions.Remove(intention);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Deleted planting intention {Id}", intentionId);
            }
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
            _logger.LogInformation("Attempting to retrieve notes from database");

            var query = _appContext.Notes.AsNoTracking();
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                query = query.Where(n => n.TradeUnit == null || tuList.Contains(n.TradeUnit));
            }
            return await query
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
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
            return await _appContext.Notes
                .AsNoTracking()
                .Where(n => n.CustomerId == customerId)
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
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

    public async Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default)
        => await _appContext.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);

    public async Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Get customer info for denormalized fields
            var customer = await _context.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Id == customerId, cancellationToken);
            if (customer == null)
            {
                throw new InvalidOperationException($"Customer with ID {customerId} not found");
            }

            var note = new Note
            {
                CustomerId = customerId,
                CustomerName = customer.Name,
                CustomerCode = customer.SourceCustomerId,
                TradeUnit = tradeUnit,
                Description = content,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };

            _appContext.Notes.Add(note);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
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
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.IsPinned = !note.IsPinned;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
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
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.Description = content;
            note.ModifiedBy = GetCurrentUser();
            note.ModifiedAt = DateTime.UtcNow;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated note {NoteId}", noteId);
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
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId, cancellationToken);
            if (note == null)
            {
                return;
            }

            _appContext.Notes.Remove(note);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Deleted note {NoteId}", noteId);
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
            return await _appContext.ProducerDetails.AsNoTracking().FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
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
            return await _appContext.ProducerDetails.AsNoTracking().ToListAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("ProducerDetails table not accessible. Returning empty list. Error: {Error}", ex.Message);
            return new List<ProducerDetails>();
        }
    }

    public async Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? sourceCustomerId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

            if (existing != null)
            {
                existing.SourceCustomerId = sourceCustomerId;
                existing.CustomerName = customerName;
                existing.TotalAcres = totalAcres;
                existing.BinCapacity = binCapacity;
                existing.PrimaryContact = primaryContact;
                existing.Commodities = commodities;
                existing.LinkedProducerIds = linkedProducerIds;
                existing.ModifiedBy = GetCurrentUser();
                existing.ModifiedAt = DateTime.UtcNow;

                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Updated ProducerDetails for customer {CustomerId}", customerId);
                return existing;
            }
            else
            {
                var details = new ProducerDetails
                {
                    CustomerId = customerId,
                    SourceCustomerId = sourceCustomerId,
                    CustomerName = customerName,
                    TotalAcres = totalAcres,
                    BinCapacity = binCapacity,
                    PrimaryContact = primaryContact,
                    Commodities = commodities,
                    LinkedProducerIds = linkedProducerIds,
                    CreatedBy = GetCurrentUser(),
                    CreatedAt = DateTime.UtcNow
                };

                _appContext.ProducerDetails.Add(details);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Created ProducerDetails for customer {CustomerId}", customerId);
                return details;
            }
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
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
            if (existing != null)
            {
                _appContext.ProducerDetails.Remove(existing);
                await _appContext.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Deleted ProducerDetails for customer {CustomerId}", customerId);
            }
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

    // Each night run inserts a new copy of every receipt into vw_GNTA39D1.
    // Each receipt also has two rows per run: STATUS='F' (free days) and STATUS='S' (paid storage).
    // A single receipt can also be split across multiple customers (e.g. ADELAG + ADELDI on the
    // same receipt+location+timestamp), so CUSTOMER_ID is included in the partition to ensure
    // each customer gets their own rn=1 row rather than one winning arbitrarily.
    // The CTE deduplicates to exactly one row per receipt+location+customer by taking the STATUS='S'
    // row from the most recent REPORT_RUN_STAMP, eliminating both cross-run and F/S duplicates.
    // Callers append "AND ..." (not "WHERE ...") since the base query already has WHERE rn = 1.
    // Storage query reads only from ODS (ctrm.vw_GNTA39D1). CustomerId is resolved in C#
    // from dbo.CustomerSnapshot (Origination DB) — Azure SQL doesn't support cross-DB joins.
    private const string StoredGrainSql = """
        WITH LatestReceipts AS (
            SELECT
                WHR_RECEIPT_NUMBER,
                LOCATION_CODE,
                CUSTOMER_ID,
                COMMODITY_CODE,
                NET_QUANTITY,
                GROSS_QUANTITY,
                INITIAL_STORAGE_DATE,
                STORAGE_RATE,
                RECEIVABLE_AMOUNT,
                STORAGE_DAYS,
                CHARGED_FROM_DATE,
                CHARGED_THRU_DATE,
                ROW_NUMBER() OVER (
                    PARTITION BY WHR_RECEIPT_NUMBER, LOCATION_CODE, CUSTOMER_ID
                    ORDER BY REPORT_RUN_STAMP DESC,
                             CASE WHEN STATUS = 'S' THEN 0 ELSE 1 END
                ) AS rn
            FROM ctrm.vw_GNTA39D1
            WHERE STATUS IN ('S', 'F')
        )
        SELECT
            CAST(sg.WHR_RECEIPT_NUMBER AS varchar(50)) + '|' + ISNULL(sg.LOCATION_CODE, '') AS Id,
            CAST(sg.WHR_RECEIPT_NUMBER AS varchar(50)) AS ReceiptNumber,
            CAST(0 AS bigint) AS CustomerId,
            sg.CUSTOMER_ID AS CustomerCode,
            ISNULL(sg.COMMODITY_CODE, '') AS Crop,
            ISNULL(sg.NET_QUANTITY, 0) AS Quantity,
            ISNULL(sg.GROSS_QUANTITY, 0) AS GrossQuantity,
            ISNULL(sg.INITIAL_STORAGE_DATE, '1900-01-01') AS StorageStartDate,
            ISNULL(sg.STORAGE_RATE, 0) AS StorageRate,
            ISNULL(sg.LOCATION_CODE, '') AS Bin,
            ISNULL(sg.RECEIVABLE_AMOUNT, 0) AS ReceivableAmount,
            ISNULL(sg.STORAGE_DAYS, 0) AS StorageDays,
            sg.CHARGED_FROM_DATE AS ChargedFromDate,
            sg.CHARGED_THRU_DATE AS ChargedThruDate
        FROM LatestReceipts sg
        WHERE sg.rn = 1
        """;

    /// <summary>Looks up CustomerId for each storage record from the CustomerSnapshot table (Origination DB).</summary>
    private async Task EnrichStorageWithCustomerIdsAsync(List<StoredGrain> records, CancellationToken cancellationToken)
    {
        if (records.Count == 0) return;

        var customerCodes = records.Select(r => r.CustomerCode).Where(c => !string.IsNullOrEmpty(c)).Distinct().ToList();
        if (customerCodes.Count == 0) return;

        var snapshots = await _appContext.CustomerSnapshots
            .AsNoTracking()
            .Where(s => s.SourceCustomerId != null && customerCodes.Contains(s.SourceCustomerId))
            .Select(s => new { s.SourceCustomerId, s.CustomerId })
            .Distinct()
            .ToListAsync(cancellationToken);

        var lookup = snapshots
            .GroupBy(s => s.SourceCustomerId!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().CustomerId, StringComparer.OrdinalIgnoreCase);

        foreach (var record in records)
        {
            if (!string.IsNullOrEmpty(record.CustomerCode) && lookup.TryGetValue(record.CustomerCode, out var id))
            {
                record.CustomerId = id;
            }
        }
    }

    public async Task<List<StoredGrain>> GetStoredGrainAsync(IEnumerable<string>? tradeUnits = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var tuList = tradeUnits?.ToList();
            List<StoredGrain> records;
            if (tuList is { Count: > 0 })
            {
                // Find customer codes in these TUs, then load ALL their storage (cross-TU)
                var customerCodes = await _appContext.CustomerSnapshots
                    .AsNoTracking()
                    .Where(s => s.IsActive && s.SourceCustomerId != null
                        && s.TradeUnit != null && tuList.Contains(s.TradeUnit))
                    .Select(s => s.SourceCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                if (customerCodes.Count == 0) return [];

                var csv = SanitizeCsv(customerCodes);
                var sql = StoredGrainSql + " AND sg.CUSTOMER_ID IN (SELECT value FROM STRING_SPLIT(@customerCsv, ','))";
                records = await _context.Database
                    .SqlQueryRaw<StoredGrain>(sql, new SqlParameter("@customerCsv", csv))
                    .ToListAsync(cancellationToken);
            }
            else
            {
                records = await _context.Database
                    .SqlQueryRaw<StoredGrain>(StoredGrainSql)
                    .ToListAsync(cancellationToken);
            }

            await EnrichStorageWithCustomerIdsAsync(records, cancellationToken);
            return records;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain");
            return [];
        }
    }

    public async Task<List<StoredGrain>> GetStoredGrainByCustomerAsync(long customerId, CancellationToken cancellationToken = default)
    {
        try
        {
            // Look up the customer's source ID from CustomerSnapshot, then filter by it in ODS.
            var sourceCustomerId = await _appContext.CustomerSnapshots
                .AsNoTracking()
                .Where(s => s.CustomerId == customerId && s.SourceCustomerId != null)
                .Select(s => s.SourceCustomerId!)
                .FirstOrDefaultAsync(cancellationToken);

            if (string.IsNullOrEmpty(sourceCustomerId)) return [];

            var sql = StoredGrainSql + " AND sg.CUSTOMER_ID = @customerCode";
            var records = await _context.Database
                .SqlQueryRaw<StoredGrain>(sql, new SqlParameter("@customerCode", sourceCustomerId))
                .ToListAsync(cancellationToken);

            // Set CustomerId for all records (we already know it from the input)
            foreach (var r in records) r.CustomerId = customerId;

            return records;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving stored grain for customer {CustomerId}", customerId);
            return [];
        }
    }

    // =========================================================================
    // Saved List Operations
    // =========================================================================

    public async Task<List<SavedList>> GetSavedListsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var currentUser = GetCurrentUser();
            return await _appContext.SavedLists
                .AsNoTracking()
                .Where(s => s.IsActive && s.CreatedBy == currentUser)
                .OrderByDescending(s => s.CreatedAt)
                .ToListAsync(cancellationToken);
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
            _appContext.SavedLists.Add(savedList);
            await _appContext.SaveChangesAsync(cancellationToken);
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
            var currentUser = GetCurrentUser();
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == currentUser, cancellationToken);
            if (list == null) return null;
            list.Name = name;
            list.Query = query;
            list.TradeUnits = tradeUnits;
            list.Filters = filters;
            list.IncludedCustomerIds = includedCustomerIds;
            list.ExcludedCustomerIds = excludedCustomerIds;
            list.ModifiedAt = DateTime.UtcNow;
            list.ModifiedBy = currentUser;
            await _appContext.SaveChangesAsync(cancellationToken);
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
            var currentUser = GetCurrentUser();
            var list = await _appContext.SavedLists.FirstOrDefaultAsync(s => s.Id == listId && s.CreatedBy == currentUser, cancellationToken);
            if (list == null) return;
            _appContext.SavedLists.Remove(list);
            await _appContext.SaveChangesAsync(cancellationToken);
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
        // than 3 separate HTTP round-trips from the client.
        var estimates = await _appContext.DashboardPlantingEstimates
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToListAsync(cancellationToken);

        var marketShares = await _appContext.DashboardMarketShares
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);

        var actualHarvest = await _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear - 1)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);

        return new DashboardSummaryResponse
        {
            Estimates = estimates,
            MarketShares = marketShares,
            ActualHarvest = actualHarvest
        };
    }

    public async Task<List<DashboardPlantingEstimate>> GetDashboardPlantingEstimatesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardPlantingEstimates
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.Crop)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardPlantingEstimatesAsync(List<UpsertDashboardEstimateRequest> estimates, string username, CancellationToken cancellationToken = default)
    {
        if (estimates.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            // Load all existing records for this TU+year in one query, then do in-memory lookup
            var tuKey = estimates[0].TradeUnitKey;
            var year = estimates[0].PlantingYear;
            var existingMap = await _appContext.DashboardPlantingEstimates
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.Crop, cancellationToken);

            foreach (var req in estimates)
            {
                existingMap.TryGetValue(req.Crop, out var existing);
                if (req.YieldEstimate == null)
                {
                    if (existing != null)
                        _appContext.DashboardPlantingEstimates.Remove(existing);
                }
                else if (existing != null)
                {
                    existing.YieldEstimate = req.YieldEstimate;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardPlantingEstimates.Add(new DashboardPlantingEstimate
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        Crop = req.Crop,
                        PlantingYear = req.PlantingYear,
                        YieldEstimate = req.YieldEstimate,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task<List<DashboardMarketShare>> GetDashboardMarketSharesAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardMarketShares
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardMarketSharesAsync(List<UpsertDashboardMarketShareRequest> shares, string username, CancellationToken cancellationToken = default)
    {
        if (shares.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            var tuKey = shares[0].TradeUnitKey;
            var year = shares[0].PlantingYear;
            var existingMap = await _appContext.DashboardMarketShares
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.CropCategory, cancellationToken);

            foreach (var req in shares)
            {
                existingMap.TryGetValue(req.CropCategory, out var existing);
                if (req.MarketSharePct == null)
                {
                    if (existing != null)
                        _appContext.DashboardMarketShares.Remove(existing);
                }
                else if (existing != null)
                {
                    existing.MarketSharePct = req.MarketSharePct;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardMarketShares.Add(new DashboardMarketShare
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        CropCategory = req.CropCategory,
                        PlantingYear = req.PlantingYear,
                        MarketSharePct = req.MarketSharePct,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    // Dashboard Actual Harvest Operations
    public async Task<List<DashboardActualHarvest>> GetDashboardActualHarvestAsync(string tradeUnitKey, int plantingYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.DashboardActualHarvests
            .AsNoTracking()
            .Where(e => e.TradeUnitKey == tradeUnitKey && e.PlantingYear == plantingYear)
            .OrderBy(e => e.CropCategory)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertDashboardActualHarvestAsync(List<UpsertDashboardActualHarvestRequest> items, string username, CancellationToken cancellationToken = default)
    {
        if (items.Count == 0) return;
        var strategy = _appContext.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await _appContext.Database.BeginTransactionAsync(cancellationToken);

            var tuKey = items[0].TradeUnitKey;
            var year = items[0].PlantingYear;
            var existingMap = await _appContext.DashboardActualHarvests
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.CropCategory, cancellationToken);

            foreach (var req in items)
            {
                existingMap.TryGetValue(req.CropCategory, out var existing);
                if (existing != null)
                {
                    existing.Bushels = req.Bushels;
                    existing.ModifiedAt = DateTime.UtcNow;
                    existing.ModifiedBy = username;
                }
                else
                {
                    _appContext.DashboardActualHarvests.Add(new DashboardActualHarvest
                    {
                        TradeUnitKey = req.TradeUnitKey,
                        CropCategory = req.CropCategory,
                        PlantingYear = req.PlantingYear,
                        Bushels = req.Bushels,
                        CreatedAt = DateTime.UtcNow,
                        CreatedBy = username
                    });
                }
            }
            await _appContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    public async Task DeleteDashboardActualHarvestAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _appContext.DashboardActualHarvests.FindAsync([id], cancellationToken);
        if (entity != null)
        {
            _appContext.DashboardActualHarvests.Remove(entity);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    // =========================================================================
    // Bid Sheet Operations
    // =========================================================================

    public async Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode = null, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"elevators:{tradeUnitCode ?? "all"}";
        if (_cache.TryGetValue(cacheKey, out List<ElevatorCache>? cached) && cached is not null)
            return cached;

        var query = _appContext.ElevatorCaches.AsNoTracking().Where(e => e.IsActive);

        if (!string.IsNullOrEmpty(tradeUnitCode))
            query = query.Where(e => e.TradeUnitCode == tradeUnitCode);

        var result = await query.ToListAsync(cancellationToken);
        _cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
            Size = 1
        });
        return result;
    }

    public async Task<List<BidSheetLocation>> GetBidSheetLocationsAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .Include(l => l.Bids)
            .Where(l => l.TradeUnitCode == tradeUnitCode)
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<BidSheetLocation>> GetAllBidSheetLocationsAsync(CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<BidSheetLocation> CreateBidSheetLocationAsync(BidSheetLocation location, CancellationToken cancellationToken = default)
    {
        _appContext.BidSheetLocations.Add(location);
        await _appContext.SaveChangesAsync(cancellationToken);
        return location;
    }

    public async Task<BidSheetLocation?> UpdateBidSheetLocationAsync(int id, BidSheetLocation location, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetLocations
            .Include(l => l.Bids)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken);
        if (existing == null) return null;

        existing.Name = location.Name;
        existing.Address = location.Address;
        existing.City = location.City;
        existing.State = location.State;
        existing.Latitude = location.Latitude;
        existing.Longitude = location.Longitude;
        existing.ModifiedBy = location.ModifiedBy;
        existing.ModifiedAt = DateTime.UtcNow;

        await _appContext.SaveChangesAsync(cancellationToken);
        return existing;
    }

    public async Task DeleteBidSheetLocationAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetLocations.FindAsync([id], cancellationToken);
        if (existing != null)
        {
            _appContext.BidSheetLocations.Remove(existing);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task DeleteBidSheetBidsAsync(int locationId, string commodityCode, int? month = null, CancellationToken cancellationToken = default)
    {
        var query = _appContext.BidSheetLocationBids
            .Where(b => b.LocationId == locationId && b.CommodityCode == commodityCode);
        if (month.HasValue)
            query = query.Where(b => b.Month == month.Value);
        var bids = await query.ToListAsync(cancellationToken);

        if (bids.Count > 0)
        {
            _appContext.BidSheetLocationBids.RemoveRange(bids);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task BulkUpsertBidSheetBidsAsync(
        IEnumerable<GrainOriginatorPortal.Api.Models.Requests.UpsertBidSheetBidRequest> requests,
        string tradeUnitCode,
        string userId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var requestList = requests.ToList();

        // Batch-load all locations for the trade unit (1 query instead of N)
        var allLocations = await _appContext.BidSheetLocations
            .Where(l => l.TradeUnitCode == tradeUnitCode)
            .ToListAsync(cancellationToken);

        var byElevator = new Dictionary<string, BidSheetLocation>();
        foreach (var l in allLocations.Where(l => !string.IsNullOrEmpty(l.ElevatorCode)))
            byElevator.TryAdd(l.ElevatorCode!, l);
        var byName = new Dictionary<string, BidSheetLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in allLocations)
            byName.TryAdd(l.Name.Trim(), l);

        // First pass: create any missing locations in batch
        var newLocations = new List<BidSheetLocation>();
        foreach (var req in requestList)
        {
            BidSheetLocation? loc = null;
            if (!string.IsNullOrEmpty(req.ElevatorCode))
                byElevator.TryGetValue(req.ElevatorCode, out loc);
            if (loc == null && !string.IsNullOrEmpty(req.Name))
                byName.TryGetValue(req.Name.Trim(), out loc);

            if (loc == null)
            {
                var name = (req.Name ?? req.ElevatorCode ?? string.Empty).Trim();
                // Check if we already queued a new location with this name
                if (!byName.TryGetValue(name, out loc))
                {
                    loc = new BidSheetLocation
                    {
                        Name = name,
                        ElevatorCode = req.ElevatorCode,
                        TradeUnitCode = tradeUnitCode,
                        GroupName = req.GroupName,
                        Latitude = req.Latitude,
                        Longitude = req.Longitude,
                        CreatedBy = userId,
                        CreatedAt = now
                    };
                    _appContext.BidSheetLocations.Add(loc);
                    newLocations.Add(loc);
                    byName[name] = loc;
                    if (!string.IsNullOrEmpty(req.ElevatorCode))
                        byElevator[req.ElevatorCode] = loc;
                }
            }
        }

        // Single SaveChanges to persist all new locations and get their IDs
        if (newLocations.Count > 0)
            await _appContext.SaveChangesAsync(cancellationToken);

        // Batch-load all existing bids for the affected locations (1 query instead of N)
        var locationIds = allLocations.Concat(newLocations).Select(l => l.Id).ToHashSet();
        var existingBids = await _appContext.BidSheetLocationBids
            .Where(b => locationIds.Contains(b.LocationId))
            .ToListAsync(cancellationToken);
        var bidLookup = new Dictionary<(int, string, int, int), BidSheetLocationBid>();
        foreach (var b in existingBids)
            bidLookup.TryAdd((b.LocationId, b.CommodityCode, b.CropYear, b.Month), b);

        // Second pass: upsert bids using in-memory lookups (0 queries)
        foreach (var req in requestList)
        {
            BidSheetLocation? loc = null;
            if (!string.IsNullOrEmpty(req.ElevatorCode))
                byElevator.TryGetValue(req.ElevatorCode, out loc);
            if (loc == null && !string.IsNullOrEmpty(req.Name))
                byName.TryGetValue(req.Name.Trim(), out loc);
            if (loc == null) continue;

            var key = (loc.Id, req.CommodityCode, req.CropYear, req.Month);
            if (bidLookup.TryGetValue(key, out var bid))
            {
                bid.Bid = req.Bid;
                bid.ModifiedBy = userId;
                bid.ModifiedAt = now;
            }
            else
            {
                var newBid = new BidSheetLocationBid
                {
                    LocationId = loc.Id,
                    CommodityCode = req.CommodityCode,
                    CommodityName = req.CommodityName,
                    CommodityCategory = req.CommodityCategory,
                    CropYear = req.CropYear,
                    Month = req.Month,
                    Bid = req.Bid,
                    CreatedBy = userId,
                    CreatedAt = now
                };
                _appContext.BidSheetLocationBids.Add(newBid);
                bidLookup[key] = newBid;
            }
        }

        // Single final SaveChanges for all bid upserts
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode)
            .Select(b => b.CropYear)
            .Distinct()
            .OrderBy(y => y)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode)
            .Select(b => b.CommodityCode)
            .Distinct()
            .OrderBy(c => c)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode && b.CropYear == cropYear)
            .Select(b => b.Month)
            .Distinct()
            .OrderBy(m => m)
            .ToListAsync(cancellationToken);
    }

    // =========================================================================
    // Bid Sheet Location Order (drag-to-reorder persistence)
    // =========================================================================

    public async Task<BidSheetLocationOrder?> GetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetLocationOrders
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TradeUnitKey == tradeUnitKey, cancellationToken);
    }

    public async Task SetBidSheetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetLocationOrders
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TradeUnitKey == tradeUnitKey, cancellationToken);

        if (existing is not null)
        {
            existing.LocationOrder = locationOrderJson;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        else
        {
            _appContext.BidSheetLocationOrders.Add(new BidSheetLocationOrder
            {
                UserId = userId,
                TradeUnitKey = tradeUnitKey,
                LocationOrder = locationOrderJson,
                ModifiedAt = DateTime.UtcNow
            });
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    // =========================================================================
    // Bid Sheet Preferences (per-user per-TU UI preferences)
    // =========================================================================

    public async Task<BidSheetPreference?> GetBidSheetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken = default)
    {
        return await _appContext.BidSheetPreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TradeUnitKey == tradeUnitKey, cancellationToken);
    }

    public async Task SetBidSheetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder = null, string? hiddenCrops = null, string? selectedMonths = null, CancellationToken cancellationToken = default)
    {
        var existing = await _appContext.BidSheetPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TradeUnitKey == tradeUnitKey, cancellationToken);

        if (existing is not null)
        {
            existing.CropCode = cropCode;
            existing.Month = month;
            existing.CropYear = cropYear;
            if (cropOrder is not null) existing.CropOrder = cropOrder;
            if (hiddenCrops is not null) existing.HiddenCrops = hiddenCrops;
            if (selectedMonths is not null) existing.SelectedMonths = selectedMonths;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        else
        {
            _appContext.BidSheetPreferences.Add(new BidSheetPreference
            {
                UserId = userId,
                TradeUnitKey = tradeUnitKey,
                CropCode = cropCode,
                Month = month,
                CropYear = cropYear,
                CropOrder = cropOrder,
                HiddenCrops = hiddenCrops,
                SelectedMonths = selectedMonths,
                ModifiedAt = DateTime.UtcNow
            });
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    // =========================================================================
    // Query Library Operations
    // =========================================================================

    public async Task<List<QueryLibraryItem>> GetQueryLibraryAsync(CancellationToken cancellationToken = default)
    {
        return await _appContext.QueryLibrary
            .AsNoTracking()
            .Where(q => q.IsActive)
            .OrderBy(q => q.Category)
            .ThenBy(q => q.SortOrder)
            .ThenBy(q => q.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task LogQuerySearchAsync(string searchText, int? matchedQueryId, CancellationToken cancellationToken = default)
    {
        _appContext.QuerySearchLogs.Add(new QuerySearchLog
        {
            UserId = GetCurrentUser(),
            SearchText = searchText,
            MatchedQueryId = matchedQueryId,
            Timestamp = DateTime.UtcNow
        });
        await _appContext.SaveChangesAsync(cancellationToken);
    }
}
