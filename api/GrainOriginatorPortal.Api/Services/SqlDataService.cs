using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Interfaces;
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
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<SqlDataService> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly IMemoryCache _cache;
    // Phase 2: domain repositories are introduced one at a time; SqlDataService forwards to them
    // during the transition. Once all domains are migrated, SqlDataService + IDataService are deleted.
    private readonly IQueryLibraryRepository _queryLibraryRepository;
    private readonly ICommodityRepository _commodityRepository;

    public SqlDataService(OriginationDbContext context, ApplicationDbContext appContext, ILogger<SqlDataService> logger, IHttpContextAccessor httpContextAccessor, IMemoryCache cache, IQueryLibraryRepository queryLibraryRepository, ICommodityRepository commodityRepository)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
        _cache = cache;
        _queryLibraryRepository = queryLibraryRepository;
        _commodityRepository = commodityRepository;
    }

    private string GetTraceId() =>
        _httpContextAccessor.HttpContext?.Items[CorrelationIdMiddleware.ItemsKey]?.ToString()
        ?? _httpContextAccessor.HttpContext?.TraceIdentifier
        ?? "no-trace";

    /// <summary>
    /// CTRM represents an OPEN contract's ClosedDate three ways: NULL, blank (also reads as
    /// NULL on a date column), or the 0001-01-01 min-date sentinel (DateTime.MinValue here).
    /// A contract is open when its ClosedDate is null or this sentinel; any other (real) date
    /// means closed. Used as the C# open/closed test and mirrored in SQL.
    /// </summary>
    private static readonly DateTime OpenClosedDateSentinel = new(1, 1, 1);

    /// <summary>
    /// Normalizes the 0001-01-01 "open" sentinel to null so the frontend's `!closedDate`
    /// check and all downstream C# `== null` tests treat these contracts as open. Call
    /// after materializing contracts from the ODS.
    /// </summary>
    private static void NormalizeOpenClosedDates(IEnumerable<Contract> contracts)
    {
        foreach (var c in contracts)
            if (c.ClosedDate.HasValue && c.ClosedDate.Value <= OpenClosedDateSentinel)
                c.ClosedDate = null;
    }

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
    private async Task<Dictionary<string, string>> ResolveDisplayNamesAsync(IEnumerable<string> userIds, CancellationToken cancellationToken)
    {
        var distinct = userIds
            .Where(u => !string.IsNullOrEmpty(u))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (distinct.Count == 0) return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        // Snapshot stores the left-of-@ portion, so match by the short form.
        var shortForms = distinct.Select(v =>
        {
            var at = v.IndexOf('@');
            return at > 0 ? v[..at] : v;
        }).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var rows = await _appContext.UserTradeUnitSnapshots
            .AsNoTracking()
            .Where(u => shortForms.Contains(u.UserId))
            .Select(u => new { u.UserId, u.DisplayName })
            .Distinct()
            .ToListAsync(cancellationToken);

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows.GroupBy(r => r.UserId, StringComparer.OrdinalIgnoreCase))
        {
            var displayName = r.First().DisplayName;
            // Register the short form so direct lookups work
            map[r.Key] = displayName;
            // Also register every full-UPN form that came in for this short form so callers
            // passing "CEgr@scoular.com" or "cegr@scoular.com" both resolve.
            foreach (var full in distinct)
            {
                var at = full.IndexOf('@');
                var shortForm = at > 0 ? full[..at] : full;
                if (shortForm.Equals(r.Key, StringComparison.OrdinalIgnoreCase))
                {
                    map[full] = displayName;
                }
            }
        }
        return map;
    }

    /// <summary>Replace UPN in a single value with its display name, or leave unchanged if unknown.</summary>
    private static string ApplyDisplayName(string? upn, IReadOnlyDictionary<string, string> map) =>
        !string.IsNullOrEmpty(upn) && map.TryGetValue(upn, out var dn) ? dn : (upn ?? string.Empty);

    /// <summary>Sort key for customer names: strips leading non-alphanumeric characters
    /// (e.g. a "(NICKNAME)" or "*" prefix carried on raw CTRM names such as
    /// "(YOUNG) WESLEY TOTTEN") so those names sort in their natural alphabetical position
    /// instead of ahead of every plain-letter name.</summary>
    private static string NameSortKey(string? name)
    {
        if (string.IsNullOrEmpty(name)) return string.Empty;
        var i = 0;
        while (i < name.Length && !char.IsLetterOrDigit(name[i])) i++;
        return i == 0 ? name : name[i..];
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

            // Reads dbo.Customer (one row per CustomerId) joined to dbo.CustomerTradeUnit
            // when a TU scope is supplied. No ROW_NUMBER dedup needed — the new schema is
            // one-row-per-customer by construction.
            IQueryable<Customer> query = _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive);

            if (hasTradeUnitFilter)
            {
                query = query.Where(c => _appContext.CustomerTradeUnits.Any(ctu =>
                    ctu.CustomerId == c.Id
                    && ctu.IsActive
                    && tradeUnits!.Contains(ctu.TradeUnit)));
            }

            // Sort in memory (the set is already materialized + enriched) using a key that
            // ignores any leading non-alphanumeric prefix, so an onboarded "(YOUNG) WESLEY
            // TOTTEN" slots in under W/Y rather than jumping to the top ahead of plain names.
            var customers = await query.ToListAsync(cancellationToken);
            customers = customers
                .OrderBy(c => NameSortKey(c.Name), StringComparer.OrdinalIgnoreCase)
                .ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            await EnrichCustomersWithESignAsync(customers, cancellationToken);
            _logger.LogInformation("Returning {Count} customers from Customer{Filter}", customers.Count, filterMsg);
            return customers;
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
            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();

            if (searchWords.Count == 0)
                return [];

            // Reads dbo.Customer (one row per CustomerId — no ROW_NUMBER dedup needed) with
            // a parameterized LIKE-per-word AND-across-words match. TU scope is applied via
            // EXISTS against dbo.CustomerTradeUnit. PrimaryContact match is still a correlated
            // subquery against dbo.ProducerDetails — that's an app-DB join that EF LINQ would
            // generate inefficiently, so we keep raw SQL.
            var whereClauses = new List<string> { "c.IsActive = 1" };
            var parameters = new List<SqlParameter>();

            if (hasTradeUnitFilter)
            {
                var csv = SanitizeCsv(tradeUnits!);
                whereClauses.Add(@"EXISTS (
                    SELECT 1 FROM dbo.CustomerTradeUnit ctu
                    WHERE ctu.CustomerId = c.CustomerId
                      AND ctu.IsActive = 1
                      AND ctu.TradeUnit IN (SELECT value FROM STRING_SPLIT(@tradeUnits, ','))
                )");
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
                    c.CustomerName LIKE '%' + {paramName} + '%'
                    OR c.ScoularId LIKE '%' + {paramName} + '%'
                    OR c.MerchandisingPhone LIKE '%' + {paramName} + '%'
                    OR c.ExtendedPrimaryPhone LIKE '%' + {paramName} + '%'
                    OR c.MerchandisingCity LIKE '%' + {paramName} + '%'
                    OR c.MerchandisingStateProvince = {paramName}
                    OR c.CustomerId IN (SELECT CustomerId FROM dbo.ProducerDetails WHERE PrimaryContact LIKE '%' + {paramName} + '%')
                )");
            }

            var where = string.Join(" AND ", whereClauses);
            var sql = $@"
                SELECT c.* FROM dbo.Customer c
                WHERE {where}";

            var customers = await _appContext.Customers
                .FromSqlRaw(sql, parameters.ToArray())
                .AsNoTracking()
                .ToListAsync(cancellationToken);

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
            _logger.LogInformation("Search for '{SearchTerm}' returned {Count} customers from Customer", searchTerm, scoredCustomers.Count);
            return scoredCustomers;
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
            var searchWords = searchTerm.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries)
                                        .Select(w => w.Trim())
                                        .Where(w => w.Length > 0)
                                        .ToList();
            if (searchWords.Count == 0) return [];

            // Mirror the quality filters baked into originations.vw_CustomerTradeUnits so the
            // onboarding search never surfaces junk master-data records (placeholder /
            // duplicate / do-not-use rows) the sync would also reject.
            var whereClauses = new List<string>
            {
                "c.IndustryCode1 = 'PR'",
                "c.IsActive = 1",
                "c.IsDuplicate = 0",
                "c.CustomerName NOT LIKE '%DUP%'",
                "c.CustomerName NOT LIKE '%DO NOT USE%'",
                "LEFT(c.CustomerName, 1) NOT IN ('*', '$')"
            };
            var parameters = new List<SqlParameter>();
            for (int i = 0; i < searchWords.Count; i++)
            {
                var p = $"@w{i}";
                parameters.Add(new SqlParameter(p, searchWords[i]));
                whereClauses.Add($@"(
                    c.CustomerName LIKE '%' + {p} + '%'
                    OR c.ScoularId LIKE '%' + {p} + '%'
                    OR c.SourceCustomerId LIKE '%' + {p} + '%'
                )");
            }
            var where = string.Join(" AND ", whereClauses);

            // TOP 50 keeps the result set bounded — this is a type-ahead, not an export.
            var sql = $@"
                SELECT TOP 50
                    c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1,
                    c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
                    c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
                    c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
                    c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
                    c.EffectiveStartDate, c.EffectiveEndDate
                FROM base.vw_CurrentCustomers c
                WHERE {where}
                ORDER BY c.CustomerName";

            var rows = await _context.Database
                .SqlQueryRaw<OdsCustomerRow>(sql, parameters.ToArray())
                .ToListAsync(cancellationToken);

            if (rows.Count == 0) return [];

            // Drop any that already live in dbo.Customer — those aren't "new" and would dupe.
            var candidateIds = rows.Select(r => r.CustomerId).ToList();
            var existingIds = (await _appContext.Customers.AsNoTracking()
                    .Where(c => candidateIds.Contains(c.Id))
                    .Select(c => c.Id)
                    .ToListAsync(cancellationToken))
                .ToHashSet();

            var result = rows
                .Where(r => !existingIds.Contains(r.CustomerId))
                .Select(MapOdsRowToCustomer)
                .ToList();

            _logger.LogInformation("ODS customer search for '{SearchTerm}' returned {Count} onboardable producers", searchTerm, result.Count);
            return result;
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

    /// <summary>Maps a base.vw_CurrentCustomers row onto the Customer DTO. IsManual stays
    /// false here — the row is only a search candidate until it's actually onboarded.</summary>
    private static Customer MapOdsRowToCustomer(OdsCustomerRow r) => new()
    {
        Id = r.CustomerId,
        ScoularId = r.ScoularId?.Trim(),
        Name = r.CustomerName ?? string.Empty,
        IndustryCode1 = r.IndustryCode1,
        Location = r.MerchandisingCity,
        StateProvince = r.MerchandisingStateProvince,
        AddressLine1 = r.MerchandisingAddressLine1,
        PostalCode = r.MerchandisingPostalCode,
        Phone = r.MerchandisingPhone,
        Email = r.MerchandisingEmail,
        ExtendedPrimaryPhone = r.ExtendedPrimaryPhone,
        SupplementalEmail = r.SupplementalEmail,
        ExtendedAddressLine1 = r.ExtendedAddressLine1,
        ExtendedAddressLine2 = r.ExtendedAddressLine2,
        ExtendedAddressLine3 = r.ExtendedAddressLine3,
        ExtendedAddressLine4 = r.ExtendedAddressLine4,
        ExtendedCity = r.ExtendedCity,
        ExtendedPostalCode = r.ExtendedPostalCode,
        ExtendedStateProvince = r.ExtendedStateProvince,
        ExtendedCountry = r.ExtendedCountry,
        EffectiveStartDate = r.EffectiveStartDate,
        EffectiveEndDate = r.EffectiveEndDate,
        IsActive = true,
        IsManual = false,
    };

    /// <summary>Row shape for base.vw_CurrentCustomers reads (search + onboard). Property
    /// names match the selected column names so EF's SqlQueryRaw can bind them.</summary>
    private sealed class OdsCustomerRow
    {
        public long CustomerId { get; set; }
        public string? ScoularId { get; set; }
        public string? CustomerName { get; set; }
        public string? IndustryCode1 { get; set; }
        public string? MerchandisingCity { get; set; }
        public string? MerchandisingStateProvince { get; set; }
        public string? MerchandisingAddressLine1 { get; set; }
        public string? MerchandisingPostalCode { get; set; }
        public string? MerchandisingPhone { get; set; }
        public string? MerchandisingEmail { get; set; }
        public string? ExtendedPrimaryPhone { get; set; }
        public string? SupplementalEmail { get; set; }
        public string? ExtendedAddressLine1 { get; set; }
        public string? ExtendedAddressLine2 { get; set; }
        public string? ExtendedAddressLine3 { get; set; }
        public string? ExtendedAddressLine4 { get; set; }
        public string? ExtendedCity { get; set; }
        public string? ExtendedPostalCode { get; set; }
        public string? ExtendedStateProvince { get; set; }
        public string? ExtendedCountry { get; set; }
        public DateTime? EffectiveStartDate { get; set; }
        public DateTime? EffectiveEndDate { get; set; }
    }

    /// <summary>
    /// Looks up eSign enrollment records for the given customers and populates
    /// ESignEnabled and ScoularViewRecipients from dbo.eSignEnrollment.
    /// Async version — queries the DB. Used by callers that don't pre-fetch eSign data.
    /// </summary>
    private async Task EnrichCustomersWithESignAsync(List<Customer> customers, CancellationToken cancellationToken = default)
    {
        if (customers.Count == 0) return;

        var codes = customers
            .Where(c => c.ScoularId != null)
            .Select(c => c.ScoularId!)
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
        // Case-insensitive CustomerCode so eSign enrollment lookups match Customer.ScoularId
        // regardless of casing drift between the two sources (SQL collation is already case-insensitive).
        var enrollments = enrollmentList
            .GroupBy(e => e.CustomerCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.FirstOrDefault(e =>
                    !string.IsNullOrWhiteSpace(e.ScoularViewRecipients) &&
                    !e.ScoularViewRecipients!.Equals("No", StringComparison.OrdinalIgnoreCase)
                )?.ScoularViewRecipients,
                StringComparer.OrdinalIgnoreCase);

        foreach (var customer in customers)
        {
            if (customer.ScoularId != null &&
                enrollments.TryGetValue(customer.ScoularId, out var recipients))
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
            return await _appContext.Customers.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
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
            return await _appContext.Customers.AsNoTracking()
                .FirstOrDefaultAsync(c => c.ScoularId == scoularId, cancellationToken);
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
        if (string.IsNullOrWhiteSpace(scoularId)) return [];
        try
        {
            // Resolve the target's ScoularId to a CustomerId, then find all FromCustomerIds
            // in dbo.CustomerLink whose ToCustomerId matches. This replaces the prior
            // CSV-substring search against ProducerDetails.LinkedProducerIds (column dropped
            // in Phase 3b in favor of the dbo.CustomerLink join table).
            var toCustomerId = await _appContext.Customers.AsNoTracking()
                .Where(c => c.ScoularId == scoularId)
                .Select(c => c.Id)
                .FirstOrDefaultAsync(cancellationToken);
            if (toCustomerId == 0) return [];

            var matchingCustomerIds = await _appContext.CustomerLinks.AsNoTracking()
                .Where(l => l.ToCustomerId == toCustomerId)
                .Select(l => l.FromCustomerId)
                .Distinct()
                .ToListAsync(cancellationToken);

            if (matchingCustomerIds.Count == 0) return [];

            var customers = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && matchingCustomerIds.Contains(c.Id))
                .ToListAsync(cancellationToken);

            // Enrich with LinkedProducerIds (composed from dbo.CustomerLink) so the
            // frontend can follow chains. Other ProducerDetails fields (bin capacity,
            // primary contact, commodities) are applied by the frontend via its
            // producerDetailsMap() cache.
            //
            // Project to just (CustomerId, TotalAcres) so EF emits SELECT on those
            // two columns only — the full ProducerDetails row has ~12 columns we'd
            // otherwise pull across the wire and discard.
            var acresByCustomerId = await _appContext.ProducerDetails.AsNoTracking()
                .Where(pd => matchingCustomerIds.Contains(pd.CustomerId) && pd.TotalAcres != null)
                .Select(pd => new { pd.CustomerId, Acres = pd.TotalAcres!.Value })
                .ToDictionaryAsync(x => x.CustomerId, x => x.Acres, cancellationToken);

            // Batch-fetch all outgoing CustomerLink rows for the customer set, then
            // group in memory to assign LinkedProducerIds CSVs.
            var allLinks = await _appContext.CustomerLinks.AsNoTracking()
                .Where(l => matchingCustomerIds.Contains(l.FromCustomerId))
                .Join(_appContext.Customers.AsNoTracking(),
                      l => l.ToCustomerId,
                      cust => cust.Id,
                      (l, cust) => new { l.FromCustomerId, cust.ScoularId })
                .Where(x => x.ScoularId != null)
                .ToListAsync(cancellationToken);
            var linksByFrom = allLinks
                .GroupBy(x => x.FromCustomerId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.ScoularId!).ToList());

            foreach (var c in customers)
            {
                if (acresByCustomerId.TryGetValue(c.Id, out var acres))
                {
                    c.TotalAcres = (int)acres;
                }
                if (linksByFrom.TryGetValue(c.Id, out var linked))
                {
                    c.LinkedProducerIds = linked;
                }
            }

            await EnrichCustomersWithESignAsync(customers, cancellationToken);
            return customers;
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
            var exists = await _appContext.Customers.AsNoTracking()
                .AnyAsync(c => c.Id == customerId, cancellationToken);
            if (!exists)
            {
                _logger.LogWarning("Customer {CustomerId} not found for update", customerId);
                return;
            }

            // Location / Phone / Email originate from the ODS and cannot be written from here.
            // FarmIds / LinkedProducerIds / TotalAcres are not persisted via this path — they live
            // on ProducerDetails and are updated through the ProducerDetails endpoints.
            _logger.LogInformation("UpdateCustomerAsync called for {CustomerId} — no-op (write path lives on ProducerDetails).", customerId);
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
    /// If the customer isn't in dbo.Customer yet, pulls their attributes from base.vw_CurrentCustomers
    /// and inserts them (IsManual=true). Codes in the set are activated/inserted as manual; manual
    /// assignments not in the set are soft-deactivated (preserved for re-adding). Sync-sourced rows
    /// (IsManual=false) are never touched. An empty set is valid for an existing producer (clears all
    /// manual assignments) but rejected for a brand-new onboarding (nothing to create them with).
    /// Returns a status so the controller can 404 a bad id.
    /// </summary>
    public async Task<AssignTradeUnitsResult> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, CancellationToken cancellationToken = default)
    {
        // Normalize: trim, drop blanks, de-dupe (case-insensitive).
        var codes = tradeUnitCodes
            .Select(c => c?.Trim() ?? string.Empty)
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Ensure the customer exists in dbo.Customer — insert from ODS if this is a
        // brand-new onboarding (producer with no contract/ticket).
        var customerExists = await _appContext.Customers
            .AnyAsync(c => c.Id == customerId, cancellationToken);

        // An empty set can't onboard a brand-new producer (nothing anchors the insert), but
        // for an existing producer it's a valid request to clear all manual assignments.
        if (!customerExists && codes.Count == 0) return AssignTradeUnitsResult.NoCodes;

        if (!customerExists)
        {
            var odsRow = await GetOdsCustomerRowAsync(customerId, cancellationToken);
            if (odsRow is null)
            {
                _logger.LogWarning("AssignTradeUnits: customer {CustomerId} not found in base.vw_CurrentCustomers", customerId);
                return AssignTradeUnitsResult.CustomerNotFound;
            }
            var inserted = MapOdsRowToCustomer(odsRow);
            inserted.IsManual = true;
            inserted.IsActive = true;
            _appContext.Customers.Add(inserted);
        }
        else
        {
            // Reactivate a previously-deactivated customer being re-onboarded.
            var existing = await _appContext.Customers.FirstAsync(c => c.Id == customerId, cancellationToken);
            if (!existing.IsActive)
            {
                existing.IsActive = true;
                existing.IsManual = true;
            }
        }

        // Existing TU pairs for this customer — used to reconcile against the desired set.
        var existingTus = await _appContext.CustomerTradeUnits
            .Where(t => t.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        var existingByCode = existingTus.ToDictionary(t => t.TradeUnit, StringComparer.OrdinalIgnoreCase);
        var desired = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);

        // Activate / insert every desired code as a manual assignment. Re-adding a code that
        // exists (e.g. a previously-removed manual row, IsActive=false) reactivates it in place
        // rather than inserting a duplicate.
        foreach (var code in codes)
        {
            if (existingByCode.TryGetValue(code, out var existingTu))
            {
                // Only (re)flag manual when we're actually activating a non-active row. Never
                // re-stickify a row that's already an ACTIVE sync membership — it may have
                // graduated to synced (IsManual=false) while this dialog was open, and we don't
                // want a stale save to flip it back to manual. Active manual rows are left as-is.
                if (!existingTu.IsActive)
                {
                    existingTu.IsActive = true;
                    existingTu.IsManual = true;
                    // Clear any prior dormant-removal flag: a fresh manual re-add supersedes it, so
                    // this becomes a normal manual row again and the sync won't keep "respecting a
                    // removal" the user just undid. (Covers: dormant-remove a sync TU, then manually
                    // re-add the same code.)
                    existingTu.UserDeactivated = false;
                }
            }
            else
            {
                _appContext.CustomerTradeUnits.Add(new CustomerTradeUnit
                {
                    CustomerId = customerId,
                    TradeUnit  = code,
                    IsActive   = true,
                    IsManual   = true,
                });
            }
        }

        // Soft-deactivate manual assignments the user removed (active manual TUs not in the
        // desired set). The row is preserved so it can be re-added/reactivated later. Sync
        // assignments (IsManual=false) are never touched — they're locked in the UI.
        var deactivated = 0;
        foreach (var existing in existingTus)
        {
            if (existing.IsManual && existing.IsActive && !desired.Contains(existing.TradeUnit))
            {
                existing.IsActive = false;
                deactivated++;
            }
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("AssignTradeUnits: customer {CustomerId} reconciled to {Count} manual TU(s) [{Codes}], {Deactivated} deactivated",
            customerId, codes.Count, string.Join(", ", codes), deactivated);
        return AssignTradeUnitsResult.Ok;
    }

    public async Task<List<CustomerTradeUnitInfo>> GetCustomerTradeUnitsAsync(long customerId, CancellationToken cancellationToken = default)
    {
        // Active memberships (unchanged from before — this part is identical to the original query).
        var memberships = await _appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(t => t.CustomerId == customerId && t.IsActive)
            .OrderBy(t => t.TradeUnit)
            .Select(t => new CustomerTradeUnitInfo { TradeUnit = t.TradeUnit, IsManual = t.IsManual })
            .ToListAsync(cancellationToken);

        if (memberships.Count == 0) return memberships;

        // NEW: tag each membership with HasOpenActivity so the dialog can show a LOCKED
        // (sync-sourced) TU as "dormant → removable" once the producer has no open contract /
        // unapplied ticket there. Computed on-demand (single producer → fast, seeks). FAIL-SAFE:
        // any failure leaves HasOpenActivity = true, i.e. keep the TU locked — we never wrongly
        // offer to remove a producer that might still be active.
        try
        {
            var scoularId = await _appContext.Customers.AsNoTracking()
                .Where(c => c.Id == customerId)
                .Select(c => c.ScoularId)
                .FirstOrDefaultAsync(cancellationToken);

            if (!string.IsNullOrEmpty(scoularId))
            {
                var openTus = await GetOpenActivityTradeUnitsAsync(scoularId, cancellationToken);
                foreach (var m in memberships)
                    m.HasOpenActivity = openTus.Contains(m.TradeUnit.Trim());
            }
            // else: no ScoularId → can't check activity → leave HasOpenActivity = true (locked).
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Open-activity check failed for customer {CustomerId}; keeping TUs locked (HasOpenActivity=true) [{TraceId}]",
                customerId, GetTraceId());
            // DTO defaults HasOpenActivity = true, so memberships already fail safe here.
        }

        return memberships;
    }

    /// <summary>
    /// Returns the set of trade-unit codes the producer (by ScoularId) currently has OPEN activity
    /// in: an open purchase contract, OR an active unapplied (U/L) ticket. Drives the "dormant →
    /// removable" decision for sync-sourced TU memberships (used by <see cref="GetCustomerTradeUnitsAsync"/>,
    /// the dormant-removal validation, and the CustomerSync bring-back pass).
    ///
    /// Reliable mappings (verified): a contract carries its <c>TradeUnit</c> directly; an unapplied
    /// ticket's <c>OrganizationCode</c> IS its trade unit (org codes share the contract TradeUnit
    /// domain and OrganizationCode is always populated). Single-producer scope → both reads seek
    /// (CustomerCode/CtrmCustomerId), so this is cheap. Unapplied tickets include U/L AND C-prefix
    /// (customer-storage); the C tickets are storage-gated exactly like the per-producer Unapplied
    /// Tickets tab, so only grain the producer still actively holds counts (priced-out orphan
    /// storage doesn't). The 3-year ticket cutoff mirrors <see cref="GetUnappliedTicketsByCustomerAsync"/>
    /// so ancient orphan tickets don't lock a TU forever.
    /// PUBLIC so CustomerSyncService's bring-back pass calls the EXACT same rule — if the dialog and
    /// the sync disagreed on "active", a user removal could be undone on the next sync (a loop).
    /// </summary>
    public async Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken)
    {
        var openTus = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(scoularId)) return openTus;

        // (a) Open purchase contracts → TradeUnit is on the contract. Open = ClosedDate null or the
        // 0001-01-01 sentinel (same test used elsewhere, e.g. GetTodaysTicketsAsync).
        var contractTus = await _context.Contracts
            .AsNoTracking()
            .Where(c => c.IsActive && c.ContractPrefixType == "P"
                && c.CtrmCustomerId == scoularId
                && c.TradeUnit != null
                && (c.ClosedDate == null || c.ClosedDate <= OpenClosedDateSentinel))
            .Select(c => c.TradeUnit!)
            .Distinct()
            .ToListAsync(cancellationToken);
        foreach (var tu in contractTus)
            if (!string.IsNullOrWhiteSpace(tu)) openTus.Add(tu.Trim());

        // (b) Active unapplied tickets → OrganizationCode is the trade unit. Includes U/L AND
        // C-prefix (customer-storage), then storage-gates the C tickets so priced-out orphan
        // storage doesn't count. Same predicate + 3-year cutoff + 120s timeout + gate as the
        // per-producer Unapplied Tickets tab, so this matches exactly what the user sees there.
        _context.Database.SetCommandTimeout(120);
        var cutoff = DateTime.UtcNow.AddYears(-3).ToString("yyyy-MM-dd");
        var unappliedTickets = await _context.Tickets
            .AsNoTracking()
            .Where(t => t.IsActive
                && (t.TicketType == "U" || t.TicketType == "P")
                && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                && t.CustomerCode == scoularId
                && t.CtrmContractNumber != null
                && (t.CtrmContractNumber.StartsWith("U") || t.CtrmContractNumber.StartsWith("L") || t.CtrmContractNumber.StartsWith("C"))
                && t.OrganizationCode != null
                && t.Date != null && string.Compare(t.Date, cutoff) >= 0)
            .ToListAsync(cancellationToken);

        // Gate C-prefix (storage) tickets against active storage (U/L pass through untouched).
        // Only runs when there are C tickets, so producers with none cost nothing extra.
        if (unappliedTickets.Exists(t => t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)))
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(new[] { scoularId }, cancellationToken);
            unappliedTickets = GateCustomerStorageTickets(unappliedTickets, storageByCustomer);
        }

        foreach (var t in unappliedTickets)
            if (!string.IsNullOrWhiteSpace(t.OrganizationCode)) openTus.Add(t.OrganizationCode!.Trim());

        return openTus;
    }

    /// <summary>
    /// Removes a producer from a sync-sourced (locked) trade unit they are dormant in. Re-validates
    /// dormancy server-side (guards a stale dialog), then soft-deactivates the row and sets
    /// UserDeactivated=true so the nightly sync won't resurrect it until the producer regains open
    /// activity in that TU (the sync's bring-back pass). Touches only this one membership row.
    /// </summary>
    public async Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, CancellationToken cancellationToken = default)
    {
        var code = (tradeUnit ?? string.Empty).Trim();
        if (code.Length == 0) return DeactivateTradeUnitResult.NotFound;

        var row = await _appContext.CustomerTradeUnits
            .FirstOrDefaultAsync(t => t.CustomerId == customerId && t.IsActive && t.TradeUnit == code, cancellationToken);
        if (row == null) return DeactivateTradeUnitResult.NotFound;

        // Re-validate dormancy: if the producer actually still has an open contract or unapplied
        // ticket in this TU, refuse (the dialog was stale). Also refuse when we can't determine
        // activity (no ScoularId) — fail safe = never remove an account we can't verify.
        var scoularId = await _appContext.Customers.AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => c.ScoularId)
            .FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrEmpty(scoularId))
            return DeactivateTradeUnitResult.StillActive; // can't verify → don't remove

        var openTus = await GetOpenActivityTradeUnitsAsync(scoularId, cancellationToken);
        if (openTus.Contains(code))
            return DeactivateTradeUnitResult.StillActive;

        // Dormant → remove. UserDeactivated is the signal the sync honors (see CustomerSyncService).
        row.IsActive = false;
        row.UserDeactivated = true;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Dormant trade unit {TradeUnit} removed for customer {CustomerId} (user removal; UserDeactivated set) [{ErrorCode}] [{ErrorCategory}]",
            code, customerId, "AUDIT_UPDATE", "DataMutation");
        return DeactivateTradeUnitResult.Ok;
    }

    /// <summary>Reads a single producer row from base.vw_CurrentCustomers by CustomerId.</summary>
    private async Task<OdsCustomerRow?> GetOdsCustomerRowAsync(long customerId, CancellationToken cancellationToken)
    {
        var rows = await _context.Database
            .SqlQueryRaw<OdsCustomerRow>(@"
                SELECT TOP 1
                    c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1,
                    c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
                    c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
                    c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
                    c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
                    c.EffectiveStartDate, c.EffectiveEndDate
                FROM base.vw_CurrentCustomers c
                WHERE c.CustomerId = @customerId", new SqlParameter("@customerId", customerId))
            .ToListAsync(cancellationToken);
        return rows.FirstOrDefault();
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
            // vw_CurrentContracts joined to thousands of producer IDs via STRING_SPLIT can run
            // well over the default 30s on larger environments (QA, prod). A timeout here causes
            // the inner exception handler to return [] which makes "All producers with contracts"
            // and other contract-aware queries silently come back empty. Same 300s ceiling we use
            // on the tickets bulk; the call still runs once per TU change, not per click.
            _context.Database.SetCommandTimeout(300);

            var hasTradeUnitFilter = tradeUnits != null && tradeUnits.Count > 0;

            // Two-path strategy. Both paths now use STRING_SPLIT downstream so we never hit
            // SQL Server's 2100-parameter IN-clause limit even when the unfiltered path returns
            // thousands of producer IDs.
            List<Contract> contracts;

            if (!hasTradeUnitFilter)
            {
                // Unfiltered: every active producer in dbo.Customer. Trade unit selection is a
                // narrowing convenience, not an entitlement boundary — when nothing is selected
                // the user can search across the full producer base.
                var customerCtrmIds = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null)
                    .Select(c => c.ScoularId!)
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
                              AND (c.ClosedDate IS NULL OR c.ClosedDate <= {OpenClosedDateSentinel} OR c.CropYear >= {DateTime.Today.Year - 1})")
                        .AsNoTracking()
                        .OrderByDescending(c => c.Id)
                        .ToListAsync(cancellationToken);
                }
            }
            else
            {
                // Step 1: get producer customer IDs from dbo.Customer (app DB, fast indexed lookup),
                // scoped to the selected trade units via dbo.CustomerTradeUnit. The new schema is
                // one-row-per-customer so no further dedup is needed.
                var ctrmIds = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.ScoularId != null && c.IsActive
                        && _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id
                            && ctu.IsActive
                            && tradeUnits!.Contains(ctu.TradeUnit)))
                    .Select(c => c.ScoularId!)
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
                              AND (c.ClosedDate IS NULL OR c.ClosedDate <= {OpenClosedDateSentinel} OR c.CropYear >= {DateTime.Today.Year - 1})")
                        .AsNoTracking()
                        .OrderByDescending(c => c.Id)
                        .ToListAsync(cancellationToken);
                }
            }

            _logger.LogInformation("Loaded {ContractCount} contracts for customers who have contracts or tickets (filtered: {IsFiltered}, tradeUnitCount: {TradeUnitCount})",
                contracts.Count, hasTradeUnitFilter, hasTradeUnitFilter ? tradeUnits!.Count : 0);

            // Open contracts may carry the 0001-01-01 sentinel instead of NULL — normalize to
            // null so the frontend and downstream code treat them as open.
            NormalizeOpenClosedDates(contracts);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            await EnrichWithHedgeMarketMonthAsync(contracts, cancellationToken);
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

    private sealed class ContractHedgeRow
    {
        public long ContractId { get; set; }
        public string? HedgeMarketMonthDescription { get; set; }
        public string? PriceMarketMonthDescription { get; set; }
    }

    /// <summary>
    /// Pulls HedgeMarketMonthDescription / PriceMarketMonthDescription from base.Contract for
    /// the given contracts and assigns them onto the instances. These columns aren't exposed
    /// via vw_CurrentContracts, so the main fetch can't include them — this side-query
    /// fills the gap. Silently swallows DB errors so a missing column on the underlying
    /// table never breaks the contracts endpoint.
    /// </summary>
    private async Task EnrichWithHedgeMarketMonthAsync(List<Contract> contracts, CancellationToken cancellationToken)
    {
        if (contracts.Count == 0) return;
        try
        {
            var ids = contracts.Select(c => c.Id.ToString()).ToList();
            var idsCsv = SanitizeIdentifierCsv(ids);
            var rows = await _context.Database
                .SqlQueryRaw<ContractHedgeRow>(
                    $@"SELECT c.ContractId, c.HedgeMarketMonthDescription, c.PriceMarketMonthDescription
                       FROM base.Contract c
                       INNER JOIN STRING_SPLIT('{idsCsv}', ',') ids ON c.ContractId = TRY_CAST(ids.value AS bigint)")
                .ToListAsync(cancellationToken);
            var byId = rows.ToDictionary(r => r.ContractId);
            foreach (var c in contracts)
            {
                if (byId.TryGetValue(c.Id, out var row))
                {
                    c.HedgeMarketMonthDescription = row.HedgeMarketMonthDescription;
                    c.PriceMarketMonthDescription = row.PriceMarketMonthDescription;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to enrich contracts with HedgeMarketMonth — continuing without it [{TraceId}]", GetTraceId());
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

    public async Task<List<Contract>> GetContractsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Resolve ScoularId if not supplied by the caller (avoids a DB round-trip when the client already has it).
            if (string.IsNullOrEmpty(scoularId))
            {
                scoularId = await _appContext.Customers.AsNoTracking()
                    .Where(c => c.Id == customerId)
                    .Select(c => c.ScoularId)
                    .FirstOrDefaultAsync(cancellationToken);
                if (string.IsNullOrEmpty(scoularId))
                {
                    _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId", customerId);
                    return [];
                }
            }

            // Match contracts: open contracts + prior-year (for pacing comparison)
            var pacingCutoffYear = DateTime.Today.Year - 1;
            var contracts = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId == scoularId
                    && (c.ClosedDate == null || c.ClosedDate <= OpenClosedDateSentinel || c.CropYear >= pacingCutoffYear))
                .OrderByDescending(c => c.Id)
                .ToListAsync(cancellationToken);

            // Open contracts may carry the 0001-01-01 sentinel — normalize to null.
            NormalizeOpenClosedDates(contracts);

            // Calculate status and set defaults for fields not in ODS view
            var today = DateTime.Today;
            foreach (var contract in contracts)
            {
                contract.Status = CalculateContractStatus(contract, today);
                contract.Signed = true; // Default to signed since ODS doesn't have this field
            }

            await EnrichWithHedgeMarketMonthAsync(contracts, cancellationToken);
            _logger.LogInformation("Found {ContractCount} contracts for customer {CustomerId} (ScoularId: {ScoularId})",
                contracts.Count, customerId, scoularId);
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
            var scoularId = await _appContext.Customers.AsNoTracking()
                .Where(c => c.Id == customerId)
                .Select(c => c.ScoularId)
                .FirstOrDefaultAsync(cancellationToken);
            if (string.IsNullOrEmpty(scoularId))
            {
                _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId — returning empty historical contracts", customerId);
                return [];
            }

            var pacingCutoffYear = DateTime.Today.Year - 1;
            var contracts = await _context.Contracts
                .FromSqlInterpolated($@"
                    SELECT c.* FROM base.Contract c
                    WHERE c.IsActive = 1
                      AND c.IsDeleted = 0
                      AND c.ContractPrefixType = 'P'
                      AND c.CtrmCustomerId = {scoularId}
                      AND c.ClosedDate IS NOT NULL AND c.ClosedDate > {OpenClosedDateSentinel}
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
            // Resolve producer CtrmCustomerIds from dbo.Customer, optionally scoped to TUs
            // via dbo.CustomerTradeUnit. Trade unit selection is a narrowing convenience,
            // not an entitlement boundary — when nothing is selected we return contracts
            // for every active producer.
            var ctrmIdsQuery = _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && c.ScoularId != null);
            if (tradeUnits != null && tradeUnits.Count > 0)
            {
                ctrmIdsQuery = ctrmIdsQuery.Where(c => _appContext.CustomerTradeUnits.Any(ctu =>
                    ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits.Contains(ctu.TradeUnit)));
            }
            var ctrmIds = await ctrmIdsQuery
                .Select(c => c.ScoularId!)
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

            // Normalize the 0001-01-01 open-sentinel to null so open/closed reads correctly.
            NormalizeOpenClosedDates(contracts);

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

    public async Task<List<ContractPricingLine>> GetPricingLinesByCustomerAsync(string scoularId, CancellationToken cancellationToken = default)
    {
        try
        {
            // base.vw_ContractPricing has no customer_id column — resolve via contracts
            var sourceContractIds = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.CtrmCustomerId == scoularId && c.ContractPrefixType == "P")
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
            _logger.LogWarning("vw_ContractPricing not accessible for customer {CustomerId}. Returning empty list. Error: {Error}", scoularId, ex.Message);
            return new List<ContractPricingLine>();
        }
    }

    // =========================================================================
    // Ticket Operations - Loads from vw_CurrentTickets in ODS
    // NOTE: ~2 million tickets exist, so queries are carefully limited
    // =========================================================================

    /// <summary>
    /// Loads U/P tickets in two scopes via a single SQL query:
    ///   - Applied path: ticket's CtrmContractNumber matches one of <paramref name="openContractNumbers"/> (any customer).
    ///     Critical for CTRM data where a ticket's CustomerCode can differ from the contract's CtrmCustomerId
    ///     (split tickets, partial applications, related-entity drift) — filtering by CustomerCode dropped these.
    ///   - Unapplied path: ticket's CtrmContractNumber starts with U, L, or C (the limbo prefixes) AND CustomerCode
    ///     is in <paramref name="customerCodes"/>. Spot Loads / Unapplied tab still rely on customer scope.
    ///     C-prefix (customer-storage) tickets are then gated post-query against active storage
    ///     (see <see cref="GateCustomerStorageTickets"/>) so priced-out grain stops showing.
    /// Uses STRING_SPLIT for both lists to dodge the 2100-parameter IN-clause limit.
    /// <para><paramref name="includeStorageTickets"/>: when false, customer-storage (C-prefix) tickets are
    /// excluded entirely and the storage gate is skipped — this avoids the slow ctrm.vw_GNTA39D1 scan.
    /// When true, C-prefix tickets are included and gated to active storage. Spot Loads (today's tickets),
    /// the per-producer Unapplied list, and Build-a-List all pass true so storage loads show consistently
    /// across the app — at the cost of the storage lookup, which runs only for customers that have C tickets.</para>
    /// </summary>
    private async Task<List<Ticket>> LoadTicketsByContractAndCustomerScopeAsync(
        List<string> openContractNumbers,
        List<string> customerCodes,
        CancellationToken cancellationToken,
        string? cutoffDateInclusive = null,
        bool includeStorageTickets = true)
    {
        if (openContractNumbers.Count == 0 && customerCodes.Count == 0) return new List<Ticket>();

        // vw_CurrentTickets is a heavy view (~2M rows). The view's plan against ContractNumber
        // can't seek (no usable index for our access pattern), so the bulk TU-wide scan can run
        // 2-3+ minutes. A 120s cap was getting clipped (~125s) and returning [] which made the
        // UI render "(0)" applied tickets forever. 300s is the practical ceiling — the bulk runs
        // off the request path (background after TU select) and per-customer scopes still return
        // in <2s when CustomerCode seeks cleanly. A local synced ticket table is the durable fix.
        _context.Database.SetCommandTimeout(300);

        // STRING_SPLIT can't take an empty CSV in this app's existing pattern; pass a sentinel
        // that won't match anything when one list is empty so the OR branch becomes a no-op.
        // Contract numbers can legitimately contain spaces (e.g. "PW 452117"), so use the
        // identifier-safe sanitizer for that list; customer codes use the stricter one.
        var contractsCsv = openContractNumbers.Count > 0 ? SanitizeIdentifierCsv(openContractNumbers) : "__none__";
        var codesCsv = customerCodes.Count > 0 ? SanitizeCsv(customerCodes) : "__none__";

        // The TicketBlDate column on vw_CurrentTickets is stored as a string; an inclusive
        // ISO yyyy-MM-dd cutoff lets the SpotLoads / today's-tickets path narrow the result
        // set at the SQL layer. Null cutoff = no date filter (used by the broad contracts page paths).
        // (C# property Ticket.Date maps to DB column TicketBlDate; raw SQL has to use the column name.)
        var cutoff = cutoffDateInclusive ?? string.Empty;

        // 1 = include C-prefix (customer-storage) unapplied tickets; 0 = U/L only. When 0 the storage
        // gate below is also skipped, so this whole call stays off the slow ctrm.vw_GNTA39D1 scan.
        var storageFlag = includeStorageTickets ? 1 : 0;

        // Two indexed lookups UNION ALL'd (the two branches are mutually exclusive — applied
        // tickets carry a P-prefix contract number, unapplied carry U/L/C — so SQL Server's
        // UNION dedup step is wasted work on a multi-million-row view). Each branch is an
        // INNER JOIN to STRING_SPLIT on an indexed column (ContractNumber / CustomerCode), so
        // the optimizer picks index seeks instead of scans. The cutoff is parameterized once
        // and applied symmetrically.
        //
        // Column list is explicit (not SELECT *) — names every column the EF Ticket entity maps,
        // matching OriginationDbContext.OnModelCreating for Ticket. Saves the view's row-width
        // bloat from columns we don't read. Adding a new mapped column to Ticket REQUIRES adding
        // it here too — EF materialization will fail if a mapped column is missing from the result.
        //
        // The unapplied prefix predicate uses three sargable LIKE 'X%' tests (not LEFT(col,1) IN ...)
        // so the optimizer can index-seek the prefix range on ContractNumber. The LEFT() form was
        // non-sargable and forced a scan of every row reached by the CustomerCode seek.
        //
        // Excludes BSTATS='CSL' (Consolidated) tickets — those have already been merged INTO
        // another ticket and showing them double-counts the bushels. PRG (Purged) doesn't reach
        // this view at all, so no filter needed. NULL-status rows kept defensively.
        var tickets = await _context.Tickets
            .FromSqlInterpolated($@"
                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.IsActive, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({contractsCsv}, ',') x ON t.ContractNumber = x.value
                WHERE t.IsActive = 1 AND t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))

                UNION ALL

                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.IsActive, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({codesCsv}, ',') c ON t.CustomerCode = c.value
                WHERE t.IsActive = 1 AND t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND t.ContractNumber IS NOT NULL
                  AND (t.ContractNumber LIKE 'U%' OR t.ContractNumber LIKE 'L%'
                       OR ({storageFlag} = 1 AND t.ContractNumber LIKE 'C%'))
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))")
            .AsNoTracking()
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Gate customer-storage (C-prefix) tickets: keep one only while the producer still holds
        // that commodity in active storage. Priced-out storage leaves orphan unload tickets in
        // vw_CurrentTickets that would otherwise show as unapplied forever. Only the C-prefix
        // tickets (which come from the CustomerCode branch above) are affected; applied (P) and
        // U/L tickets pass through. Looked up only for the customers that actually have C tickets,
        // so producers with no storage cost nothing. Skipped entirely when storage is excluded
        // (no C tickets to gate, and avoids the slow ctrm.vw_GNTA39D1 lookup).
        if (!includeStorageTickets) return tickets;

        var storageCustomerCodes = tickets
            .Where(t => t.CtrmContractNumber is { Length: > 0 } cn
                && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(t.CustomerCode))
            .Select(t => t.CustomerCode!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (storageCustomerCodes.Count > 0)
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(storageCustomerCodes, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        return tickets;
    }

    /// <summary>
    /// Loads ONLY unapplied (U/L, optionally C-storage) tickets scoped by CustomerCode — the fast,
    /// index-seekable branch of <see cref="LoadTicketsByContractAndCustomerScopeAsync"/> with the
    /// 2M-row ContractNumber-scan branch omitted ENTIRELY (not just fed an empty list — that join
    /// can't seek even for a no-match value, so it would still scan). Spot Loads / today's-tickets
    /// is the only caller: the UI discards every applied ticket, so the contract-scoped branch was
    /// pure waste there and was what made the dropdown spin for minutes.
    /// <para>STRING_SPLIT keeps a large producer set under the 2100-parameter IN-clause limit.
    /// C-prefix (customer-storage) tickets are gated against active storage only when
    /// <paramref name="includeStorageTickets"/> is true; today's path passes false and skips the gate.</para>
    /// </summary>
    private async Task<List<Ticket>> LoadUnappliedTicketsByCustomerScopeAsync(
        List<string> customerCodes,
        CancellationToken cancellationToken,
        string? cutoffDateInclusive = null,
        bool includeStorageTickets = true)
    {
        if (customerCodes.Count == 0) return new List<Ticket>();

        // CustomerCode seeks cleanly on vw_CurrentTickets, so this returns in <2s even TU-wide.
        // (The slow path was the omitted ContractNumber-scan branch.) 120s is a generous cold-cache cap.
        _context.Database.SetCommandTimeout(120);

        // codesCsv is never empty here (guarded above), so no "__none__" sentinel is needed.
        var codesCsv = SanitizeCsv(customerCodes);
        var cutoff = cutoffDateInclusive ?? string.Empty;
        var storageFlag = includeStorageTickets ? 1 : 0;

        // Branch 2 of LoadTicketsByContractAndCustomerScopeAsync, standalone. The column list MUST
        // stay in sync with the EF Ticket mapping (OriginationDbContext.OnModelCreating) — EF
        // materialization fails if a mapped column is missing from the result.
        var tickets = await _context.Tickets
            .FromSqlInterpolated($@"
                SELECT t.TicketId, t.ContractId, t.CustomerId, t.CustomerCode, t.ProductCode,
                       t.TicketPrefix, t.TicketNumber, t.TicketSuffix, t.ShipmentTicketNumber, t.ContractNumber,
                       t.OrganizationCode, t.ElevatorCode, t.UnloadOrganizationCode,
                       t.TicketBlDate, t.FinalSettledDate,
                       t.UnloadQuantity, t.LoadoutQuantity, t.AppliedNetQuantity,
                       t.TicketType, t.TicketStatusDescription, t.IsActive, t.GradeCode
                FROM base.vw_CurrentTickets t
                INNER JOIN STRING_SPLIT({codesCsv}, ',') c ON t.CustomerCode = c.value
                WHERE t.IsActive = 1 AND t.TicketType IN ('U','P')
                  AND (t.TicketStatusDescription IS NULL OR t.TicketStatusDescription <> 'Consolidated')
                  AND t.ContractNumber IS NOT NULL
                  AND (t.ContractNumber LIKE 'U%' OR t.ContractNumber LIKE 'L%'
                       OR ({storageFlag} = 1 AND t.ContractNumber LIKE 'C%'))
                  AND ({cutoff} = '' OR (t.TicketBlDate IS NOT NULL AND t.TicketBlDate >= {cutoff}))")
            .AsNoTracking()
            .OrderByDescending(t => t.Date)
            .ToListAsync(cancellationToken);

        // Today's path passes includeStorageTickets: false, so it returns here and never touches
        // the slow ctrm.vw_GNTA39D1 storage scan. Storage gating mirrors the shared method exactly.
        if (!includeStorageTickets) return tickets;

        var storageCustomerCodes = tickets
            .Where(t => t.CtrmContractNumber is { Length: > 0 } cn
                && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(t.CustomerCode))
            .Select(t => t.CustomerCode!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (storageCustomerCodes.Count > 0)
        {
            var storageByCustomer = await GetActiveStorageCommoditiesAsync(storageCustomerCodes, cancellationToken);
            tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
        }

        return tickets;
    }

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
                // Unfiltered: every active producer in dbo.Customer. Trade unit selection is
                // a narrowing convenience, not an entitlement boundary.
                var customerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null)
                    .Select(c => c.ScoularId!)
                    .ToListAsync(cancellationToken);

                if (customerCodes.Count == 0)
                {
                    tickets = [];
                }
                else
                {
                    // Same contract-scoped pattern as the filtered branch — applied tickets
                    // follow their contract, not the ticket's CustomerCode. Without this, a
                    // ticket whose CustomerCode is missing from dbo.Customer (inactive /
                    // deleted / cross-system entity) would be dropped even when its contract
                    // is otherwise visible.
                    var openContractNumbers = await _context.Contracts
                        .AsNoTracking()
                        .Where(c => c.IsActive && c.ContractPrefixType == "P"
                            && (c.ClosedDate == null || c.ClosedDate <= OpenClosedDateSentinel)
                            && c.CtrmCustomerId != null && customerCodes.Contains(c.CtrmCustomerId)
                            && c.SourceContractId != null)
                        .Select(c => c.SourceContractId!)
                        .Distinct()
                        .ToListAsync(cancellationToken);

                    tickets = await LoadTicketsByContractAndCustomerScopeAsync(
                        openContractNumbers, customerCodes, cancellationToken);
                }
            }
            else
            {
                // Customer scope = producers in the selected TUs (via dbo.CustomerTradeUnit).
                var customerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null
                        && _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits!.Contains(ctu.TradeUnit)))
                    .Select(c => c.ScoularId!)
                    .ToListAsync(cancellationToken);

                // Open Purchase contracts whose customer is in the TU scope. We then load tickets
                // by their CtrmContractNumber matching this set — applied tickets follow the
                // contract, not the ticket's CustomerCode. CTRM data has split / cross-entity
                // tickets where ticket.CustomerCode != contract.CtrmCustomerId; filtering by
                // CustomerCode silently dropped those, so the contract under-reported deliveries.
                var openContractNumbers = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P"
                        && (c.ClosedDate == null || c.ClosedDate <= OpenClosedDateSentinel)
                        && c.CtrmCustomerId != null && customerCodes.Contains(c.CtrmCustomerId)
                        && c.SourceContractId != null)
                    .Select(c => c.SourceContractId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                tickets = await LoadTicketsByContractAndCustomerScopeAsync(
                    openContractNumbers, customerCodes, cancellationToken);
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
        var elevatorCodes = tickets
            .Where(t => !string.IsNullOrWhiteSpace(t.ElevatorCode))
            .Select(t => t.ElevatorCode!.Trim())
            .Distinct()
            .ToList();

        // Tickets without a meaningful ElevatorCode (whitespace-only counts) fall back to
        // a GNP003 (location) lookup keyed on OrganizationCode. Collect those org codes up
        // front so we can run the fallback query in parallel with the main elevator query.
        var fallbackLocationCodes = tickets
            .Where(t => string.IsNullOrWhiteSpace(t.ElevatorCode) && !string.IsNullOrWhiteSpace(t.OrganizationCode))
            .Select(t => t.OrganizationCode!.Trim())
            .Distinct()
            .ToList();

        if (elevatorCodes.Count == 0 && fallbackLocationCodes.Count == 0) return;

        try
        {
            // Join ticket → vw_GNP026 on (ElevatorCode = Elevator_Code, OrganizationCode = Elevator_Location_Code).
            // OrganizationCode is the ticket's owning org and is always populated; UnloadOrganizationCode
            // only fills in once a ticket settles, so it can be empty on unapplied tickets.
            var elevatorList = elevatorCodes.Count > 0
                ? await _context.Set<Elevator>()
                    .AsNoTracking()
                    .Where(e => e.ElevatorCode != null && elevatorCodes.Contains(e.ElevatorCode))
                    .ToListAsync(cancellationToken)
                : new List<Elevator>();

            // Fallback lookup against vw_GNP003 for tickets that don't have an ElevatorCode.
            // We match the ticket's OrganizationCode to Location_Code and surface city/state.
            var locationList = fallbackLocationCodes.Count > 0
                ? await _context.Set<Location>()
                    .AsNoTracking()
                    .Where(l => l.LocationCode != null && fallbackLocationCodes.Contains(l.LocationCode))
                    .ToListAsync(cancellationToken)
                : new List<Location>();

            // Elevator lookup keyed exclusively by composite (ElevatorCode + ElevatorLocationCode).
            // We don't keep a bare-ElevatorCode fallback — codes like DIRECT are shared
            // across many physical locations and the bare-code lookup would pick an
            // arbitrary row, mislabeling every non-composite-matched ticket.
            var elevatorLookup = new Dictionary<string, Elevator>();
            foreach (var e in elevatorList)
            {
                if (e.ElevatorCode == null) continue;
                var compositeKey = $"{e.ElevatorCode.Trim()}|{(e.ElevatorLocationCode ?? "").Trim()}";
                if (!elevatorLookup.ContainsKey(compositeKey))
                    elevatorLookup[compositeKey] = e;
            }

            // Location fallback lookup keyed by Location_Code only.
            var locationLookup = new Dictionary<string, Location>();
            foreach (var l in locationList)
            {
                if (l.LocationCode == null) continue;
                var key = l.LocationCode.Trim();
                if (!locationLookup.ContainsKey(key))
                    locationLookup[key] = l;
            }

            foreach (var ticket in tickets)
            {
                var orgCode = (ticket.OrganizationCode ?? "").Trim();

                if (!string.IsNullOrWhiteSpace(ticket.ElevatorCode))
                {
                    // Primary path — composite GNP026 lookup
                    var code = ticket.ElevatorCode.Trim();
                    if (elevatorLookup.TryGetValue($"{code}|{orgCode}", out var elev))
                    {
                        ticket.ElevatorCity = elev.City?.Trim();
                        ticket.ElevatorState = elev.State?.Trim();
                    }
                }
                else if (orgCode.Length > 0 && locationLookup.TryGetValue(orgCode, out var loc))
                {
                    // Fallback — ticket has no elevator code, resolve via GNP003 by OrganizationCode
                    ticket.ElevatorCity = loc.City?.Trim();
                    ticket.ElevatorState = loc.State?.Trim();
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Elevator/location lookup failed — tickets will load without location data [{TraceId}]", GetTraceId());
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
                // Unfiltered: every active producer in dbo.Customer.
                var customerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null)
                    .Select(c => c.ScoularId!)
                    .ToListAsync(cancellationToken);

                // Spot Loads only ever displays UNAPPLIED tickets (the UI skips applied ones), so we
                // run the fast CustomerCode-scoped branch only. The old applied/contract-number branch
                // scanned the 2M-row view (couldn't seek) and its rows were all discarded downstream —
                // dropping it is what turns this from minutes into <2s. Empty codes return [] inside.
                // includeStorageTickets: true so C-prefix (customer-storage) loads appear here too,
                // matching the customer page's Unapplied Tickets tab (gated to active storage). Adds
                // the ctrm.vw_GNTA39D1 storage lookup, but only for customers that actually have C tickets.
                tickets = await LoadUnappliedTicketsByCustomerScopeAsync(
                    customerCodes, cancellationToken, cutoffStr, includeStorageTickets: true);
            }
            else
            {
                // Branch 1 (contract-number scope) is gone — Spot Loads discards applied tickets — but
                // the contract-derived CUSTOMER codes still widen which producers' unapplied loads
                // appear (a producer can have a P-contract tagged to a TU without an active
                // CustomerTradeUnit snapshot row), so we keep deriving them to preserve identical
                // producer scope. Only SourceContractId (which fed Branch 1) is dropped.
                var contractCustomerCodes = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                        && c.TradeUnit != null && tradeUnits!.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var snapshotCustomerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null
                        && _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id && ctu.IsActive && tradeUnits!.Contains(ctu.TradeUnit)))
                    .Select(c => c.ScoularId!)
                    .ToListAsync(cancellationToken);

                var customerCodes = contractCustomerCodes.Union(snapshotCustomerCodes).ToList();

                // includeStorageTickets: true — see the no-filter branch above. C-prefix storage loads
                // are surfaced in Spot Loads (gated to active storage) for parity with the customer page.
                tickets = await LoadUnappliedTicketsByCustomerScopeAsync(
                    customerCodes, cancellationToken, cutoffStr, includeStorageTickets: true);
            }

            _logger.LogInformation("Loaded {TicketCount} recent tickets for spot loads (filtered: {IsFiltered}, cutoff: {CutoffStr})",
                tickets.Count, hasTradeUnitFilter, cutoffStr);

            // Intentionally NO quality (moisture/protein/test-weight) or elevator city/state enrichment
            // here: appState.todaysTickets is consumed only by Actionable Insights → Spot Loads, which
            // displays none of those fields. Skipping them drops 1-3 extra round-trips (the
            // TicketQualities IN-clause + the ctrm.vw_GNP026 / vw_GNP003 elevator lookups) off this
            // UI-blocking call. The full /api/tickets path (GetTicketsAsync) still enriches.
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

    public async Task<List<Ticket>> GetTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Resolve ScoularId if not supplied by the caller (avoids a DB round-trip when the client already has it).
            if (string.IsNullOrEmpty(scoularId))
            {
                scoularId = await _appContext.Customers.AsNoTracking()
                    .Where(c => c.Id == customerId)
                    .Select(c => c.ScoularId)
                    .FirstOrDefaultAsync(cancellationToken);
                if (string.IsNullOrEmpty(scoularId))
                {
                    _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId", customerId);
                    return [];
                }
            }

            // Build the customer's open Purchase contract number set. We match tickets to
            // contracts via the string SourceContractId ↔ ContractNumber pairing because the
            // bigint Ticket.ContractId FK isn't reliably populated in vw_CurrentTickets (split
            // tickets / older records can have null). The string contract number is the
            // authoritative join key in the ODS shape. CtrmCustomerId is the customer-level
            // filter on contracts; tickets may carry a different CustomerCode than the
            // contract's CtrmCustomerId (CTRM splits across related entities), which is why
            // the unapplied branch below still scopes by CustomerCode.
            var openContractNumbers = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P"
                    && (c.ClosedDate == null || c.ClosedDate <= OpenClosedDateSentinel)
                    && c.CtrmCustomerId == scoularId
                    && c.SourceContractId != null)
                .Select(c => c.SourceContractId!)
                .Distinct()
                .ToListAsync(cancellationToken);

            _context.Database.SetCommandTimeout(120);

            // 3-year cutoff bounds the scan against the 2M-row ticket view. Open contracts almost
            // always have delivery windows under a year, so 3 years is generous for applied tickets;
            // unapplied tickets older than 3 years aren't actionable. TicketBlDate is stored as a
            // string in the ODS, so the cutoff is an ISO yyyy-MM-dd literal which compares
            // lexicographically (safe for that format).
            var cutoff = DateTime.UtcNow.AddYears(-3).ToString("yyyy-MM-dd");

            // Single LINQ query with applied ∪ unapplied as an OR. Applied side matches
            // Ticket.ContractNumber against the customer's open Purchase contract numbers —
            // for a per-customer scope the IN list is small (a handful of contracts) so EF
            // emits an explicit IN clause the optimizer seeks on. The unapplied side is
            // anchored on the single CustomerCode plus a sargable StartsWith on
            // ContractNumber (translated to LIKE 'X%'). The two branches are mutually
            // exclusive (P-prefix vs U/L/C-prefix), so the OR doesn't double-count.
            var tickets = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive
                    && (t.TicketType == "U" || t.TicketType == "P")
                    && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                    && t.Date != null
                    && string.Compare(t.Date, cutoff) >= 0
                    && t.CtrmContractNumber != null
                    && (
                        openContractNumbers.Contains(t.CtrmContractNumber)
                        ||
                        (t.CustomerCode == scoularId
                         && (t.CtrmContractNumber.StartsWith("U")
                             || t.CtrmContractNumber.StartsWith("L")
                             || t.CtrmContractNumber.StartsWith("C")))
                    ))
                .OrderByDescending(t => t.Date)
                .ToListAsync(cancellationToken);

            // Customer-storage (C-prefix) tickets linger after the grain is priced out; keep one only
            // if the producer still holds that commodity in active storage. Gate before enrichment so
            // we don't hydrate quality/elevator for tickets we're about to drop. Mirrors
            // GetUnappliedTicketsByCustomerAsync so the customer page's Unapplied tab shows the same
            // storage-gated set regardless of which fetch populated it.
            if (tickets.Exists(t => t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)))
            {
                var storageByCustomer = await GetActiveStorageCommoditiesAsync(new[] { scoularId }, cancellationToken);
                tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
            }

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

            _logger.LogInformation("Found {TicketCount} tickets for customer {CustomerId} (ScoularId: {ScoularId})",
                tickets.Count, customerId, scoularId);
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

    /// <summary>
    /// Commodity codes each customer currently holds in active customer storage (ctrm.vw_GNTA39D1,
    /// latest snapshot, net qty &gt; 0), keyed by Scoular customer code. Used to gate C-prefix
    /// (customer-storage) unapplied tickets: a storage unload ticket stays in vw_CurrentTickets
    /// after the grain is priced out, so it only counts as unapplied while the producer still has
    /// that commodity on hand here. Mirrors the STATUS / latest-run-stamp shape of the Storage tab
    /// (<see cref="StoredGrainSql"/>) so the two screens agree on what's "in storage".
    /// </summary>
    private async Task<Dictionary<string, HashSet<string>>> GetActiveStorageCommoditiesAsync(
        IReadOnlyCollection<string> customerCodes, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        if (customerCodes.Count == 0) return result;

        var codesCsv = SanitizeCsv(customerCodes);

        // GROUP BY customer+commodity at the latest snapshot; HAVING net > 0 means the producer
        // still physically holds that commodity. Join on raw CUSTOMER_ID (T-SQL '=' ignores the
        // view's trailing spaces); SELECT/GROUP BY trim+upper for a clean dictionary key.
        const string sql = """
            SELECT UPPER(LTRIM(RTRIM(s.CUSTOMER_ID)))    AS CustomerCode,
                   UPPER(LTRIM(RTRIM(s.COMMODITY_CODE)))  AS Commodity
            FROM ctrm.vw_GNTA39D1 s
            INNER JOIN STRING_SPLIT(@codesCsv, ',') c ON s.CUSTOMER_ID = c.value
            WHERE s.STATUS IN ('S','F','D')
              AND s.REPORT_RUN_STAMP = (SELECT MAX(REPORT_RUN_STAMP) FROM ctrm.vw_GNTA39D1)
            GROUP BY UPPER(LTRIM(RTRIM(s.CUSTOMER_ID))), UPPER(LTRIM(RTRIM(s.COMMODITY_CODE)))
            HAVING SUM(ISNULL(s.NET_QUANTITY, 0)) > 0
            """;

        var rows = await _context.Database
            .SqlQueryRaw<StorageCommodity>(sql, new SqlParameter("@codesCsv", codesCsv))
            .ToListAsync(cancellationToken);

        foreach (var row in rows)
        {
            if (string.IsNullOrEmpty(row.CustomerCode) || string.IsNullOrEmpty(row.Commodity)) continue;
            if (!result.TryGetValue(row.CustomerCode, out var set))
            {
                set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[row.CustomerCode] = set;
            }
            set.Add(row.Commodity);
        }
        return result;
    }

    /// <summary>
    /// Drops customer-storage (C-prefix) tickets whose grain is no longer in storage. A C-prefix
    /// unload ticket lingers in vw_CurrentTickets after the producer prices the grain out; it's
    /// only genuinely unapplied while that commodity still shows in <paramref name="storageByCustomer"/>.
    /// U / L tickets and everything else pass through untouched. Match is commodity-level (the
    /// ticket carries no storage-receipt id), so a producer who priced out one batch but still
    /// stores another batch of the same commodity keeps the older tickets — a rare, accepted edge.
    /// </summary>
    private static List<Ticket> GateCustomerStorageTickets(
        List<Ticket> tickets, Dictionary<string, HashSet<string>> storageByCustomer)
    {
        return tickets.Where(t =>
        {
            var contractNumber = t.CtrmContractNumber;
            if (contractNumber is not { Length: > 0 } || !contractNumber.StartsWith("C", StringComparison.OrdinalIgnoreCase))
                return true; // not customer-storage — unaffected

            if (string.IsNullOrEmpty(t.CustomerCode) || string.IsNullOrEmpty(t.ProductCode))
                return false; // storage ticket we can't match to a producer/commodity — treat as priced out

            return storageByCustomer.TryGetValue(t.CustomerCode.Trim(), out var commodities)
                && commodities.Contains(t.ProductCode.Trim());
        }).ToList();
    }

    /// <summary>
    /// Fast per-producer unapplied-tickets fetch. Single CustomerCode predicate plus the U/L/C
    /// contract-prefix filter — the optimizer's most-selective shape against vw_CurrentTickets.
    /// C-prefix (customer-storage) tickets are then gated against active storage so priced-out
    /// grain stops showing (see <see cref="GateCustomerStorageTickets"/>).
    /// Used by the home page on producer select; applied tickets are loaded lazily per-contract
    /// (see <see cref="GetAppliedTicketsByContractAsync"/>) when the user expands a contract row.
    /// </summary>
    public async Task<List<Ticket>> GetUnappliedTicketsByCustomerAsync(long customerId, string? scoularId = null, CancellationToken cancellationToken = default)
    {
        try
        {
            if (string.IsNullOrEmpty(scoularId))
            {
                scoularId = await _appContext.Customers.AsNoTracking()
                    .Where(c => c.Id == customerId)
                    .Select(c => c.ScoularId)
                    .FirstOrDefaultAsync(cancellationToken);
                if (string.IsNullOrEmpty(scoularId))
                {
                    _logger.LogWarning("Customer {CustomerId} not found or has no ScoularId", customerId);
                    return [];
                }
            }

            _context.Database.SetCommandTimeout(120);

            // 3-year cutoff — old unapplied tickets aren't actionable.
            var cutoff = DateTime.UtcNow.AddYears(-3).ToString("yyyy-MM-dd");

            var tickets = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive
                    && (t.TicketType == "U" || t.TicketType == "P")
                    && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                    && t.CustomerCode == scoularId
                    && t.CtrmContractNumber != null
                    && (t.CtrmContractNumber.StartsWith("U")
                        || t.CtrmContractNumber.StartsWith("L")
                        || t.CtrmContractNumber.StartsWith("C"))
                    && t.Date != null
                    && string.Compare(t.Date, cutoff) >= 0)
                .OrderByDescending(t => t.Date)
                .ToListAsync(cancellationToken);

            // Customer-storage (C-prefix) tickets linger after the grain is priced out; keep one
            // only if the producer still holds that commodity in active storage. Filter before
            // enrichment so we don't hydrate quality/elevator for tickets we're about to drop.
            if (tickets.Exists(t => t.CtrmContractNumber is { Length: > 0 } cn && cn.StartsWith("C", StringComparison.OrdinalIgnoreCase)))
            {
                var storageByCustomer = await GetActiveStorageCommoditiesAsync(new[] { scoularId }, cancellationToken);
                tickets = GateCustomerStorageTickets(tickets, storageByCustomer);
            }

            await PopulateQualityAndElevatorAsync(tickets, cancellationToken);

            _logger.LogInformation("Found {TicketCount} unapplied tickets for customer {CustomerId} (ScoularId: {ScoularId})",
                tickets.Count, customerId, scoularId);
            return tickets;
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
    /// the optimizer its best shot at an index seek. Used by the contracts table when a row is
    /// expanded.
    /// </summary>
    public async Task<List<Ticket>> GetAppliedTicketsByContractAsync(string sourceContractId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceContractId)) return [];
        var trimmed = sourceContractId.Trim();

        try
        {
            _context.Database.SetCommandTimeout(120);

            var tickets = await _context.Tickets
                .AsNoTracking()
                .Where(t => t.IsActive
                    && (t.TicketType == "U" || t.TicketType == "P")
                    && (t.TicketStatusDescription == null || t.TicketStatusDescription != "Consolidated")
                    && t.CtrmContractNumber == trimmed)
                .OrderByDescending(t => t.Date)
                .ToListAsync(cancellationToken);

            await PopulateQualityAndElevatorAsync(tickets, cancellationToken);

            _logger.LogInformation("Found {TicketCount} applied tickets for contract {ContractNumber}",
                tickets.Count, trimmed);
            return tickets;
        }
        catch (SqlException ex) when (ex.Number == 207 || ex.Number == 208)
        {
            _logger.LogWarning(ex, "Tickets view missing column/object — returning empty list [{TraceId}]", GetTraceId());
            return [];
        }
        catch (Exception ex) when (ex is SqlException || ex.InnerException is SqlException)
        {
            _logger.LogWarning(ex, "DB error retrieving applied tickets for contract {ContractNumber} — returning empty list [{TraceId}]",
                trimmed, GetTraceId());
            return [];
        }
    }

    /// <summary>Hydrates quality (moisture/protein/test weight) and elevator city/state onto a
    /// loaded ticket set. Shared by the per-producer unapplied and per-contract applied fetches
    /// so post-load enrichment stays consistent.</summary>
    private async Task PopulateQualityAndElevatorAsync(List<Ticket> tickets, CancellationToken cancellationToken)
    {
        if (tickets.Count == 0) return;

        var ticketIds = tickets.Select(t => t.Id).ToList();
        var qualityList = await _context.TicketQualities
            .AsNoTracking()
            .Where(q => ticketIds.Contains(q.TicketId))
            .ToListAsync(cancellationToken);
        var qualityData = qualityList.ToDictionary(q => q.TicketId);
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
            IQueryable<PlantingIntention> query = _appContext.PlantingIntentions
                .AsNoTracking()
                .Include(p => p.Customer);
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                // Find customer codes from TU contracts + customer/TU memberships, then load
                // ALL their planting (cross-TU). Codes are resolved to CustomerIds and the
                // planting filter is on the FK column (CustomerCode column is gone in Phase 3b).
                var contractCustomerCodes = await _context.Contracts
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                             && c.TradeUnit != null && tuList.Contains(c.TradeUnit))
                    .Select(c => c.CtrmCustomerId!)
                    .Distinct()
                    .ToListAsync(cancellationToken);

                var customerIds = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive &&
                        ((c.ScoularId != null && contractCustomerCodes.Contains(c.ScoularId))
                         || _appContext.CustomerTradeUnits.Any(ctu =>
                                ctu.CustomerId == c.Id && ctu.IsActive && tuList.Contains(ctu.TradeUnit))))
                    .Select(c => c.Id)
                    .ToListAsync(cancellationToken);

                query = query.Where(p => customerIds.Contains(p.CustomerId));
            }
            if (plantingYear.HasValue)
            {
                query = query.Where(p => p.PlantingYear == plantingYear.Value);
            }
            var results = await query
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Customer!.Name)
                .ToListAsync(cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                results.Select(r => r.CreatedBy).Concat(results.Select(r => r.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var r in results)
            {
                // CustomerName / CustomerCode now come from the Customer FK join
                // (the columns were dropped from dbo.ProducerPlantingIntentions in Phase 3b).
                r.CustomerName = r.Customer?.Name ?? string.Empty;
                r.CustomerCode = r.Customer?.ScoularId ?? string.Empty;
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
            var results = await _appContext.PlantingIntentions
                .AsNoTracking()
                .Include(p => p.Customer)
                .Where(p => p.CustomerId == customerId)
                .OrderByDescending(p => p.PlantingYear)
                .ThenBy(p => p.Crop)
                .ToListAsync(cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                results.Select(r => r.CreatedBy).Concat(results.Select(r => r.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var r in results)
            {
                r.CustomerName = r.Customer?.Name ?? string.Empty;
                r.CustomerCode = r.Customer?.ScoularId ?? string.Empty;
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

    public async Task<PlantingIntention?> GetPlantingIntentionByIdAsync(int intentionId, CancellationToken cancellationToken = default)
    {
        var intention = await _appContext.PlantingIntentions.AsNoTracking()
            .Include(p => p.Customer)
            .FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
        if (intention != null)
        {
            intention.CustomerName = intention.Customer?.Name ?? string.Empty;
            intention.CustomerCode = intention.Customer?.ScoularId ?? string.Empty;
        }
        return intention;
    }

    public async Task<PlantingIntention> AddPlantingIntentionAsync(long customerId, string customerName, string customerCode, string tradeUnit, string crop, string? category, string? type, string? description, int acres, int plantingYear, CancellationToken cancellationToken = default)
    {
        try
        {
            // CustomerName / CustomerCode are kept on the in-memory entity for the
            // API response, but EF .Ignore()s them — they're not persisted to the
            // dropped columns. They come back fresh via FK join on subsequent reads.
            var intention = new PlantingIntention
            {
                CustomerId = customerId,
                CustomerName = customerName,
                CustomerCode = customerCode,
                TradeUnit = tradeUnit,
                Crop = crop,
                Category = category,
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
            var intention = await _appContext.PlantingIntentions
                .Include(p => p.Customer)
                .FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
            if (intention == null)
            {
                return null;
            }

            intention.Crop = crop;
            intention.Category = category;
            intention.Type = type;
            intention.Description = description;
            intention.Acres = acres;
            intention.PlantingYear = plantingYear;
            intention.ModifiedBy = GetCurrentUser();
            intention.ModifiedAt = DateTime.UtcNow;

            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated planting intention {Id}", intentionId);
            intention.CustomerName = intention.Customer?.Name ?? string.Empty;
            intention.CustomerCode = intention.Customer?.ScoularId ?? string.Empty;
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

            var query = _appContext.Notes.AsNoTracking()
                .Include(n => n.Customer)
                .Where(n => !n.IsDeleted);
            var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
            if (tuList is { Count: > 0 })
            {
                // Filter by the CUSTOMER's current trade unit, not the note's own
                // TradeUnit tag. The tag is set at note-creation time via
                // FirstOrDefaultAsync on CustomerTradeUnit — non-deterministic when
                // a customer is in multiple TUs — so notes on the same producer can
                // end up scattered across TU tags. The result was that a single-TU
                // selection could miss notes for a multi-TU producer that the user
                // was actively viewing. Anchoring the filter on the customer's
                // current TU set returns every note for any customer in scope,
                // regardless of which TU happened to win the FirstOrDefaultAsync
                // race at write time. (The TradeUnit column is now informational
                // only; writes still set it for audit purposes.)
                query = query.Where(n =>
                    _appContext.CustomerTradeUnits.Any(ctu =>
                        ctu.CustomerId == n.CustomerId
                        && ctu.IsActive
                        && tuList.Contains(ctu.TradeUnit)));
            }
            var notes = await query
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                notes.Select(n => n.CreatedBy).Concat(notes.Select(n => n.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var n in notes)
            {
                // CustomerName / CustomerCode now come from the Customer FK join
                // (the columns were dropped from dbo.Notes in Phase 3b).
                n.CustomerName = n.Customer?.Name ?? string.Empty;
                n.CustomerCode = n.Customer?.ScoularId;
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
            var notes = await _appContext.Notes
                .AsNoTracking()
                .Include(n => n.Customer)
                .Where(n => n.CustomerId == customerId && !n.IsDeleted)
                .OrderByDescending(n => n.CreatedAt)
                .ToListAsync(cancellationToken);
            var nameMap = await ResolveDisplayNamesAsync(
                notes.Select(n => n.CreatedBy).Concat(notes.Select(n => n.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var n in notes)
            {
                n.CustomerName = n.Customer?.Name ?? string.Empty;
                n.CustomerCode = n.Customer?.ScoularId;
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

    public async Task<Note?> GetNoteByIdAsync(long noteId, CancellationToken cancellationToken = default)
    {
        var note = await _appContext.Notes.AsNoTracking()
            .Include(n => n.Customer)
            .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
        if (note != null)
        {
            note.CustomerName = note.Customer?.Name ?? string.Empty;
            note.CustomerCode = note.Customer?.ScoularId;
        }
        return note;
    }

    public async Task<Note> AddNoteAsync(long customerId, string content, string? tradeUnit = null, CancellationToken cancellationToken = default)
    {
        try
        {
            // Resolve denormalized name/code from dbo.Customer (the UI's source of truth).
            var snap = await _appContext.Customers.AsNoTracking()
                .Where(c => c.Id == customerId)
                .Select(c => new { CustomerName = c.Name, c.ScoularId })
                .FirstOrDefaultAsync(cancellationToken);

            var note = new Note
            {
                CustomerId = customerId,
                CustomerName = snap?.CustomerName ?? string.Empty,
                CustomerCode = snap?.ScoularId,
                TradeUnit = tradeUnit,
                Description = content,
                CreatedBy = GetCurrentUser(),
                CreatedAt = DateTime.UtcNow
            };

            _appContext.Notes.Add(note);
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Created note {NoteId} for customer {CustomerId}", note.Id, customerId);
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
            var note = await _appContext.Notes
                .Include(n => n.Customer)
                .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.IsPinned = !note.IsPinned;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Toggled pin for note {NoteId} - IsPinned is now {IsPinned}", noteId, note.IsPinned);
            note.CustomerName = note.Customer?.Name ?? string.Empty;
            note.CustomerCode = note.Customer?.ScoularId;
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
            var note = await _appContext.Notes
                .Include(n => n.Customer)
                .FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
            if (note == null)
            {
                return null;
            }

            note.Description = content;
            note.ModifiedBy = GetCurrentUser();
            note.ModifiedAt = DateTime.UtcNow;
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Updated note {NoteId}", noteId);
            note.CustomerName = note.Customer?.Name ?? string.Empty;
            note.CustomerCode = note.Customer?.ScoularId;
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
            // Soft delete: keep the row, mark IsDeleted/DeletedAt/DeletedBy. Reads filter on
            // !IsDeleted so the user-facing behavior is unchanged, but the record can be
            // recovered later by flipping IsDeleted back to false.
            var note = await _appContext.Notes.FirstOrDefaultAsync(n => n.Id == noteId && !n.IsDeleted, cancellationToken);
            if (note == null)
            {
                return;
            }

            note.IsDeleted = true;
            note.DeletedAt = DateTime.UtcNow;
            note.DeletedBy = GetCurrentUser();
            await _appContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Soft-deleted note {NoteId} (DeletedBy={DeletedBy})", noteId, note.DeletedBy);
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
            var pd = await _appContext.ProducerDetails.AsNoTracking()
                .Include(p => p.Customer)
                .FirstOrDefaultAsync(p => p.CustomerId == customerId, cancellationToken);
            if (pd == null) return null;

            // CustomerName / ScoularId now come from the Customer FK join
            // (the columns were dropped from dbo.ProducerDetails in Phase 3b).
            pd.CustomerName = pd.Customer?.Name ?? string.Empty;
            pd.ScoularId = pd.Customer?.ScoularId;
            // LinkedProducerIds (CSV of linked-producer ScoularIds) is composed from
            // dbo.CustomerLink — the CSV column was dropped in Phase 3b.
            pd.LinkedProducerIds = await GetLinkedProducerCsvAsync(customerId, cancellationToken);
            // Commodities (CSV of commodity codes) is composed from dbo.CustomerCommodity
            // — the CSV column was dropped in Phase 4b.
            pd.Commodities = await GetCommodityCodesCsvAsync(customerId, cancellationToken);

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
            var all = await _appContext.ProducerDetails.AsNoTracking()
                .Include(p => p.Customer)
                .ToListAsync(cancellationToken);

            // Batch-fetch all CustomerLink rows for these producers in one round-trip,
            // then group in memory and assign as comma-separated ScoularIds.
            var customerIds = all.Select(p => p.CustomerId).Distinct().ToList();
            var linkRows = await _appContext.CustomerLinks.AsNoTracking()
                .Where(l => customerIds.Contains(l.FromCustomerId))
                .Join(_appContext.Customers.AsNoTracking(),
                      l => l.ToCustomerId,
                      c => c.Id,
                      (l, c) => new { l.FromCustomerId, c.ScoularId })
                .Where(x => x.ScoularId != null)
                .ToListAsync(cancellationToken);
            var linksByFrom = linkRows
                .GroupBy(x => x.FromCustomerId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.ScoularId!).ToList());

            // Same batching pattern for CustomerCommodity → commodity codes.
            var commodityRows = await _appContext.CustomerCommodities.AsNoTracking()
                .Where(cc => customerIds.Contains(cc.CustomerId))
                .Join(_appContext.Commodities.AsNoTracking(),
                      cc => cc.CommodityId,
                      c => c.Id,
                      (cc, c) => new { cc.CustomerId, c.Code })
                .Where(x => !string.IsNullOrEmpty(x.Code))
                .ToListAsync(cancellationToken);
            var commoditiesByCustomer = commodityRows
                .GroupBy(x => x.CustomerId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToList());

            var nameMap = await ResolveDisplayNamesAsync(
                all.Select(p => p.CreatedBy).Concat(all.Select(p => p.ModifiedBy ?? string.Empty)),
                cancellationToken);
            foreach (var p in all)
            {
                p.CustomerName = p.Customer?.Name ?? string.Empty;
                p.ScoularId = p.Customer?.ScoularId;
                p.LinkedProducerIds = linksByFrom.TryGetValue(p.CustomerId, out var ids) && ids.Count > 0
                    ? string.Join(",", ids)
                    : null;
                p.Commodities = commoditiesByCustomer.TryGetValue(p.CustomerId, out var codes) && codes.Count > 0
                    ? string.Join(",", codes)
                    : null;
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

    /// <summary>
    /// Composes the comma-separated list of linked-producer ScoularIds for a given
    /// from-customer by joining dbo.CustomerLink → dbo.Customer.ScoularId. Returns
    /// null when there are no links, matching the prior nullable-CSV semantics.
    /// </summary>
    private async Task<string?> GetLinkedProducerCsvAsync(long fromCustomerId, CancellationToken cancellationToken)
    {
        var scoularIds = await _appContext.CustomerLinks.AsNoTracking()
            .Where(l => l.FromCustomerId == fromCustomerId)
            .Join(_appContext.Customers.AsNoTracking(),
                  l => l.ToCustomerId,
                  c => c.Id,
                  (l, c) => c.ScoularId)
            .Where(s => s != null)
            .ToListAsync(cancellationToken);
        return scoularIds.Count == 0 ? null : string.Join(",", scoularIds!);
    }

    /// <summary>
    /// Composes the comma-separated list of commodity codes a customer grows
    /// by joining dbo.CustomerCommodity → dbo.Commodities.Code. Returns null
    /// when there are no rows, matching the prior nullable-CSV semantics on
    /// ProducerDetails.Commodities.
    /// </summary>
    private async Task<string?> GetCommodityCodesCsvAsync(long customerId, CancellationToken cancellationToken)
    {
        var codes = await _appContext.CustomerCommodities.AsNoTracking()
            .Where(cc => cc.CustomerId == customerId)
            .Join(_appContext.Commodities.AsNoTracking(),
                  cc => cc.CommodityId,
                  c => c.Id,
                  (cc, c) => c.Code)
            .Where(code => !string.IsNullOrEmpty(code))
            .ToListAsync(cancellationToken);
        return codes.Count == 0 ? null : string.Join(",", codes);
    }

    public async Task<ProducerDetails> UpsertProducerDetailsAsync(long customerId, string? scoularId, string customerName, decimal? totalAcres, decimal? binCapacity, string? primaryContact, string? commodities, string? linkedProducerIds = null, CancellationToken cancellationToken = default)
    {
        try
        {
            var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

            ProducerDetails saved;
            if (existing != null)
            {
                // ScoularId / CustomerName are kept on the in-memory entity for the
                // API response, but EF .Ignore()s them — they're not persisted to
                // dropped columns. The canonical values come from dbo.Customer.
                existing.ScoularId = scoularId;
                existing.CustomerName = customerName;
                existing.TotalAcres = totalAcres;
                existing.BinCapacity = binCapacity;
                existing.PrimaryContact = primaryContact;
                existing.Commodities = commodities;
                existing.LinkedProducerIds = linkedProducerIds;  // in-memory only; persisted via CustomerLink rebuild below
                existing.ModifiedBy = GetCurrentUser();
                existing.ModifiedAt = DateTime.UtcNow;
                saved = existing;
            }
            else
            {
                saved = new ProducerDetails
                {
                    CustomerId = customerId,
                    ScoularId = scoularId,
                    CustomerName = customerName,
                    TotalAcres = totalAcres,
                    BinCapacity = binCapacity,
                    PrimaryContact = primaryContact,
                    Commodities = commodities,
                    LinkedProducerIds = linkedProducerIds,
                    CreatedBy = GetCurrentUser(),
                    CreatedAt = DateTime.UtcNow
                };
                _appContext.ProducerDetails.Add(saved);
            }

            // Rebuild dbo.CustomerLink for this from-customer in the same EF
            // transaction as the ProducerDetails write. Drop all existing links
            // and re-insert based on the supplied CSV of linked ScoularIds.
            var oldLinks = await _appContext.CustomerLinks
                .Where(l => l.FromCustomerId == customerId)
                .ToListAsync(cancellationToken);
            if (oldLinks.Count > 0)
            {
                _appContext.CustomerLinks.RemoveRange(oldLinks);
            }
            if (!string.IsNullOrWhiteSpace(linkedProducerIds))
            {
                var ids = linkedProducerIds
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var toCustomerIds = await _appContext.Customers.AsNoTracking()
                    .Where(c => c.ScoularId != null && ids.Contains(c.ScoularId))
                    .Select(c => c.Id)
                    .ToListAsync(cancellationToken);
                foreach (var toId in toCustomerIds.Where(id => id != customerId).Distinct())
                {
                    _appContext.CustomerLinks.Add(new CustomerLink
                    {
                        FromCustomerId = customerId,
                        ToCustomerId = toId
                    });
                }
            }

            // Same rebuild pattern for dbo.CustomerCommodity. Parse the CSV of
            // commodity codes, resolve each to a CommodityId via dbo.Commodities,
            // and replace the customer's commodity set in the same transaction.
            // Codes not in the lookup are silently skipped — the UI's commodity
            // picker only surfaces valid codes.
            var oldCommodities = await _appContext.CustomerCommodities
                .Where(cc => cc.CustomerId == customerId)
                .ToListAsync(cancellationToken);
            if (oldCommodities.Count > 0)
            {
                _appContext.CustomerCommodities.RemoveRange(oldCommodities);
            }
            if (!string.IsNullOrWhiteSpace(commodities))
            {
                var codes = commodities
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var commodityIds = await _appContext.Commodities.AsNoTracking()
                    .Where(c => codes.Contains(c.Code))
                    .Select(c => c.Id)
                    .ToListAsync(cancellationToken);
                foreach (var commodityId in commodityIds.Distinct())
                {
                    _appContext.CustomerCommodities.Add(new CustomerCommodity
                    {
                        CustomerId = customerId,
                        CommodityId = commodityId
                    });
                }
            }

            await _appContext.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Upserted ProducerDetails for customer {CustomerId}", customerId);

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

    // ctrm.vw_GNTA39D1 is a nightly snapshot — every active receipt reappears each run.
    // A receipt absent from the most recent run means the grain is no longer in storage,
    // so we anchor on MAX(REPORT_RUN_STAMP) and ignore all older runs entirely.
    // Within that single run, each receipt can have multiple status rows:
    //   'S' = paid storage (being charged), 'D' = deferred/delayed billing, 'F' = free days.
    // Other statuses (closed/voided/etc.) are excluded — they represent grain no longer stored.
    // A single receipt can also be split across multiple customers (e.g. ADELAG + ADELDI on the
    // same receipt+location+timestamp), so CUSTOMER_ID is included in the partition to ensure
    // each customer gets their own rn=1 row rather than one winning arbitrarily.
    // Tiebreaker priority inside the run: S > D > F.
    // Callers append "AND ..." (not "WHERE ...") since the base query already has WHERE rn = 1.
    // Storage query reads only from ODS (ctrm.vw_GNTA39D1). CustomerId is resolved in C#
    // from dbo.Customer (Origination DB) — Azure SQL doesn't support cross-DB joins.
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
                    ORDER BY CASE WHEN STATUS = 'S' THEN 0
                                  WHEN STATUS = 'D' THEN 1
                                  ELSE 2 END
                ) AS rn
            FROM ctrm.vw_GNTA39D1
            WHERE STATUS IN ('S', 'F', 'D')
              AND REPORT_RUN_STAMP = (SELECT MAX(REPORT_RUN_STAMP) FROM ctrm.vw_GNTA39D1)
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

    /// <summary>Looks up CustomerId for each storage record from the dbo.Customer table (Origination DB).</summary>
    private async Task EnrichStorageWithCustomerIdsAsync(List<StoredGrain> records, CancellationToken cancellationToken)
    {
        if (records.Count == 0) return;

        var customerCodes = records.Select(r => r.CustomerCode).Where(c => !string.IsNullOrEmpty(c)).Distinct().ToList();
        if (customerCodes.Count == 0) return;

        var snapshots = await _appContext.Customers
            .AsNoTracking()
            .Where(c => c.ScoularId != null && customerCodes.Contains(c.ScoularId))
            .Select(c => new { c.ScoularId, CustomerId = c.Id })
            .ToListAsync(cancellationToken);

        var lookup = snapshots
            .GroupBy(s => s.ScoularId!, StringComparer.OrdinalIgnoreCase)
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
                var customerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null
                        && _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id && ctu.IsActive && tuList.Contains(ctu.TradeUnit)))
                    .Select(c => c.ScoularId!)
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
            // Look up the customer's source ID from dbo.Customer, then filter by it in ODS.
            var scoularId = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.Id == customerId && c.ScoularId != null)
                .Select(c => c.ScoularId!)
                .FirstOrDefaultAsync(cancellationToken);

            if (string.IsNullOrEmpty(scoularId)) return [];

            var sql = StoredGrainSql + " AND sg.CUSTOMER_ID = @customerCode";
            var records = await _context.Database
                .SqlQueryRaw<StoredGrain>(sql, new SqlParameter("@customerCode", scoularId))
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
            var lists = await _appContext.SavedLists
                .AsNoTracking()
                .Where(s => s.IsActive && s.CreatedBy == currentUser)
                .OrderByDescending(s => s.CreatedAt)
                .ToListAsync(cancellationToken);
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
            _appContext.SavedLists.Add(savedList);
            await _appContext.SaveChangesAsync(cancellationToken);
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

            // Load all existing records for this TU+year in one query, then do in-memory lookup.
            // Use OrdinalIgnoreCase on the dictionary because SQL Server's default collation is
            // case-insensitive — a DB row stored as "Irrigated corn" must match a request for
            // "Irrigated Corn" on the .NET side too, or the update branch is skipped and the
            // insert branch then trips the unique key constraint on (TradeUnitKey, Crop, Year).
            var tuKey = estimates[0].TradeUnitKey;
            var year = estimates[0].PlantingYear;
            var existingMap = await _appContext.DashboardPlantingEstimates
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.Crop, StringComparer.OrdinalIgnoreCase, cancellationToken);

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
                    // Normalize the stored Crop casing to match the request — the unique index
                    // is case-insensitive so this doesn't violate anything, and keeping the DB
                    // in sync with the Commodities table's display casing means the UI can find
                    // the value when it re-fetches after save.
                    existing.Crop = req.Crop;
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

            // OrdinalIgnoreCase — SQL collation is case-insensitive, so the dictionary must match.
            var tuKey = shares[0].TradeUnitKey;
            var year = shares[0].PlantingYear;
            var existingMap = await _appContext.DashboardMarketShares
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.CropCategory, StringComparer.OrdinalIgnoreCase, cancellationToken);

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
                    existing.CropCategory = req.CropCategory;  // normalize casing to match request
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

            // OrdinalIgnoreCase — SQL collation is case-insensitive, so the dictionary must match.
            var tuKey = items[0].TradeUnitKey;
            var year = items[0].PlantingYear;
            var existingMap = await _appContext.DashboardActualHarvests
                .Where(e => e.TradeUnitKey == tuKey && e.PlantingYear == year)
                .ToDictionaryAsync(e => e.CropCategory, StringComparer.OrdinalIgnoreCase, cancellationToken);

            foreach (var req in items)
            {
                existingMap.TryGetValue(req.CropCategory, out var existing);
                if (existing != null)
                {
                    existing.Bushels = req.Bushels;
                    existing.CropCategory = req.CropCategory;  // normalize casing to match request
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
            .Include(l => l.Bids)
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    /// <summary>True when a DbUpdateException was caused by a unique-index/PK violation (SQL 2601/2627).</summary>
    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is SqlException { Number: 2601 or 2627 };

    /// <summary>
    /// Recovers from a unique-constraint race on bid inserts: a concurrent request (or a retried
    /// request) already inserted a bid for the same (LocationId, CommodityCode, CropYear, Month).
    /// For each pending Added bid that now collides with a row in the DB, detach the insert and
    /// apply its value onto the existing row instead — so a re-save commits the whole batch (the
    /// user's value wins) rather than 500-ing. Returns true if anything was reconciled.
    /// </summary>
    private async Task<bool> ReconcileDuplicateBidInsertsAsync(CancellationToken cancellationToken)
    {
        var added = _appContext.ChangeTracker.Entries<BidSheetLocationBid>()
            .Where(e => e.State == EntityState.Added)
            .Select(e => e.Entity)
            .ToList();
        var reconciled = false;
        foreach (var bid in added)
        {
            // SQL Server's case-insensitive collation makes the CommodityCode compare match regardless of case.
            var existing = await _appContext.BidSheetLocationBids.FirstOrDefaultAsync(
                b => b.LocationId == bid.LocationId && b.CommodityCode == bid.CommodityCode
                     && b.CropYear == bid.CropYear && b.Month == bid.Month, cancellationToken);
            if (existing == null) continue;
            _appContext.Entry(bid).State = EntityState.Detached; // drop the duplicate insert
            existing.Bid = bid.Bid;
            existing.CommodityName = bid.CommodityName;
            existing.CommodityCategory = bid.CommodityCategory;
            existing.ModifiedBy = bid.CreatedBy;
            existing.ModifiedAt = DateTime.UtcNow;
            reconciled = true;
        }
        return reconciled;
    }

    public async Task<BidSheetLocation> CreateBidSheetLocationAsync(BidSheetLocation location, CancellationToken cancellationToken = default)
    {
        _appContext.BidSheetLocations.Add(location);
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // A child bid collided with a concurrently-inserted one — reconcile to updates and retry.
            _logger.LogWarning(ex, "CreateBidSheetLocation hit a unique-constraint race — reconciling [{TraceId}]", GetTraceId());
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
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
        existing.IsScoularFacility = location.IsScoularFacility;
        existing.ModifiedBy = location.ModifiedBy;
        existing.ModifiedAt = DateTime.UtcNow;

        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _logger.LogWarning(ex, "UpdateBidSheetLocation hit a unique-constraint race — reconciling [{TraceId}]", GetTraceId());
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
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
        // CommodityCode is normalized to uppercase on both the stored key and the lookup key
        // so a DB value of "yc" matches a request value of "YC". Matches SQL Server's
        // case-insensitive collation; avoids INSERT attempts that would trip the unique index.
        var bidLookup = new Dictionary<(int, string, int, int), BidSheetLocationBid>();
        foreach (var b in existingBids)
            bidLookup.TryAdd((b.LocationId, (b.CommodityCode ?? "").ToUpperInvariant(), b.CropYear, b.Month), b);

        // Second pass: upsert bids using in-memory lookups (0 queries)
        foreach (var req in requestList)
        {
            BidSheetLocation? loc = null;
            if (!string.IsNullOrEmpty(req.ElevatorCode))
                byElevator.TryGetValue(req.ElevatorCode, out loc);
            if (loc == null && !string.IsNullOrEmpty(req.Name))
                byName.TryGetValue(req.Name.Trim(), out loc);
            if (loc == null) continue;

            var key = (loc.Id, (req.CommodityCode ?? "").ToUpperInvariant(), req.CropYear, req.Month);
            if (string.IsNullOrWhiteSpace(req.Bid))
            {
                // Empty bid = user cleared the input → delete the existing row if present
                if (bidLookup.TryGetValue(key, out var toRemove))
                {
                    _appContext.BidSheetLocationBids.Remove(toRemove);
                    bidLookup.Remove(key);
                }
            }
            else if (bidLookup.TryGetValue(key, out var bid))
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

        // Single final SaveChanges for all bid upserts. If a concurrent request inserted one of
        // these bids first, reconcile the colliding inserts into updates and save again so the
        // whole batch commits (rather than rolling back and 500-ing).
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _logger.LogWarning(ex, "Bid upsert hit a unique-constraint race — reconciling [{TraceId}]", GetTraceId());
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
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

    public async Task SetBidSheetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear, string? cropOrder = null, string? hiddenCrops = null, string? selectedMonths = null, string? printLayout = null, CancellationToken cancellationToken = default)
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
            if (printLayout is not null) existing.PrintLayout = printLayout;
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
                PrintLayout = printLayout,
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
