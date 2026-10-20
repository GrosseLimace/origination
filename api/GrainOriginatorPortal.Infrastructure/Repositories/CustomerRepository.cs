using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class CustomerRepository : ICustomerRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly IContractRepository _contractRepository;
    private readonly ITicketRepository _ticketRepository;
    private readonly ILogger<CustomerRepository> _logger;
    private readonly IConfiguration _configuration;

    public CustomerRepository(
        OriginationDbContext context,
        ApplicationDbContext appContext,
        ITicketRepository ticketRepository,
        IContractRepository contractRepository,
        ILogger<CustomerRepository> logger,
        IConfiguration configuration)
    {
        _context = context;
        _appContext = appContext;
        _ticketRepository = ticketRepository;
        _contractRepository = contractRepository;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>Strips a leading non-alphanumeric prefix from a name for sorting (so an onboarded
    /// "(YOUNG) WESLEY TOTTEN" sorts in its natural alphabetical position instead of ahead of every
    /// plain-letter name).</summary>
    private static string NameSortKey(string? name)
    {
        if (string.IsNullOrEmpty(name)) return string.Empty;
        var i = 0;
        while (i < name.Length && !char.IsLetterOrDigit(name[i])) i++;
        return i == 0 ? name : name[i..];
    }

    public async Task<List<Customer>> GetAsync(List<string>? tradeUnits, CancellationToken cancellationToken)
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
        await EnrichCustomersWithAchAsync(customers, cancellationToken);
        await EnrichCustomersWithTradeUnitsAsync(customers, cancellationToken);
        _logger.LogInformation("Returning {Count} customers from Customer{Filter}", customers.Count, filterMsg);
        return customers;
    }

    public async Task<List<Customer>> SearchAsync(string searchTerm, List<string>? tradeUnits, CancellationToken cancellationToken)
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

        // SQL fragment that strips common phone punctuation — ( ) - space . — from a column so a
        // digits-only search fragment matches regardless of how the number is formatted in the DB.
        static string StripPhone(string col) =>
            $"REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({col},'(',''),')',''),'-',''),' ',''),'.','')";

        // Each search word must match at least one searchable field (AND across words).
        // State uses exact match to avoid false positives on short abbreviations like "CO".
        for (int i = 0; i < searchWords.Count; i++)
        {
            var paramName = $"@w{i}";
            var word = searchWords[i];
            parameters.Add(new SqlParameter(paramName, word));

            // Phone match: compare a digits-only version of the word against the punctuation-
            // stripped phone columns so e.g. "(402) 555-4914" finds a stored "4025554914" (and
            // vice versa). Only when the word carries enough digits to be a phone fragment —
            // pure-text words can never match a phone column, so we skip the (non-sargable) REPLACE.
            var digits = new string(word.Where(char.IsDigit).ToArray());
            var phoneClause = digits.Length >= 3
                ? $@"
                OR {StripPhone("c.MerchandisingPhone")} LIKE '%' + @d{i} + '%'
                OR {StripPhone("c.ExtendedPrimaryPhone")} LIKE '%' + @d{i} + '%'
                OR c.CustomerId IN (SELECT CustomerId FROM dbo.ProducerContact WHERE {StripPhone("Phone")} LIKE '%' + @d{i} + '%')"
                : string.Empty;
            if (digits.Length >= 3)
                parameters.Add(new SqlParameter($"@d{i}", digits));

            whereClauses.Add($@"(
                c.CustomerName LIKE '%' + {paramName} + '%'
                OR c.ScoularId LIKE '%' + {paramName} + '%'{phoneClause}
                OR c.MerchandisingEmail LIKE '%' + {paramName} + '%'
                OR c.SupplementalEmail LIKE '%' + {paramName} + '%'
                OR c.MerchandisingCity LIKE '%' + {paramName} + '%'
                OR c.MerchandisingStateProvince = {paramName}
                OR c.CustomerId IN (SELECT CustomerId FROM dbo.ProducerDetails WHERE PrimaryContact LIKE '%' + {paramName} + '%')
                OR c.CustomerId IN (SELECT CustomerId FROM dbo.ProducerContact WHERE Name LIKE '%' + {paramName} + '%' OR Email LIKE '%' + {paramName} + '%')
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
        await EnrichCustomersWithAchAsync(scoredCustomers, cancellationToken);
        await EnrichCustomersWithTradeUnitsAsync(scoredCustomers, cancellationToken);
        // Do not log the raw search term — it may contain producer name/phone/email (PII). Log metadata only.
        _logger.LogInformation("Customer search returned {Count} customers from Customer", scoredCustomers.Count);
        return scoredCustomers;
    }

    /// <summary>Onboarding search: producers in base.vw_CurrentCustomers that are not already
    /// onboarded. Already onboarded = same id OR same ScoularId (a CTRM-minted row carries an id
    /// the ODS has never seen, so the id alone would offer that producer a second time). Codes
    /// compare trimmed and case-insensitively; a blank code never matches anything.</summary>
    public async Task<List<Customer>> SearchOdsAsync(string searchTerm, CancellationToken cancellationToken)
    {
        var candidates = await QueryOnboardingCandidatesAsync(searchTerm, cancellationToken);
        if (candidates.Count == 0) return [];

        // Drop any that already live in dbo.Customer — by id or by ScoularId — those aren't "new"
        // and would dupe. One query; the trimmed, case-insensitive comparison runs in memory below
        // (SQL Server ignores trailing spaces and case here, the InMemory provider does neither).
        var candidateIds = candidates.Select(c => c.Id).ToList();
        var candidateCodes = candidates
            .SelectMany(c => ScoularIdQueryVariants(c.ScoularId))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var existing = await _appContext.Customers.AsNoTracking()
            // Trim() on the column, symmetric with AssignTradeUnitsAsync: SQL Server ignores only
            // trailing spaces in '=', so a stored leading space would otherwise escape the dedupe.
            .Where(c => candidateIds.Contains(c.Id) || (c.ScoularId != null && candidateCodes.Contains(c.ScoularId.Trim())))
            .Select(c => new { c.Id, c.ScoularId })
            .ToListAsync(cancellationToken);
        var existingIds = existing.Select(e => e.Id).ToHashSet();
        var existingCodes = new HashSet<string>(
            existing.Select(e => e.ScoularId?.Trim()).Where(code => !string.IsNullOrEmpty(code)).Select(code => code!),
            StringComparer.OrdinalIgnoreCase);

        var result = candidates
            .Where(c => !existingIds.Contains(c.Id))
            .Where(c => string.IsNullOrWhiteSpace(c.ScoularId) || !existingCodes.Contains(c.ScoularId.Trim()))
            .ToList();

        // Do not log the raw search term — it may contain producer name/phone (PII). Log metadata only.
        _logger.LogInformation("ODS customer search returned {Count} onboardable producers", result.Count);
        return result;
    }

    /// <summary>The values to send in a SQL <c>IN</c> list when matching dbo.Customer.ScoularId
    /// against <paramref name="code"/>: the trimmed code plus its upper- and lower-case forms.
    /// On SQL Server the case-insensitive collation makes the extra forms redundant; they let the
    /// InMemory provider (ordinal comparison) find the same rows. Blank → none.</summary>
    private static IEnumerable<string> ScoularIdQueryVariants(string? code)
    {
        var trimmed = code?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return [];
        return new[] { trimmed, trimmed.ToUpperInvariant(), trimmed.ToLowerInvariant() }.Distinct(StringComparer.Ordinal);
    }

    /// <summary>Onboarding search candidates from base.vw_CurrentCustomers (TOP 50, the sync's
    /// quality filters), mapped to Customer. No dedupe against dbo.Customer — the caller does
    /// that. Returns an empty list for a blank term. A seam: the raw ODS SQL cannot run on the
    /// InMemory provider, and E3 later re-routes the search to CTRM.</summary>
    protected virtual async Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken cancellationToken)
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
                c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
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

        return rows.Select(MapOdsRowToCustomer).ToList();
    }

    /// <summary>Maps a base.vw_CurrentCustomers row onto the Customer DTO. IsManual stays
    /// false here — the row is only a search candidate until it's actually onboarded.</summary>
    private static Customer MapOdsRowToCustomer(OdsCustomerRow r) => new()
    {
        Id = r.CustomerId,
        ScoularId = r.ScoularId?.Trim(),
        Name = r.CustomerName ?? string.Empty,
        IndustryCode1 = r.IndustryCode1,
        IndustryCode2 = r.IndustryCode2,
        NopIdNumber = OdsValues.NormaliseNopId(r.NopIdNumber),
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
        public string? IndustryCode2 { get; set; }
        public string? NopIdNumber { get; set; }
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

    /// <summary>ACH-enabled when the PaymentMethod code is 'H' (case/whitespace-insensitive).</summary>
    public static bool IsAchPaymentMethod(string? paymentMethod) =>
        string.Equals(paymentMethod?.Trim(), "H", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Enriches customers with ACH status (PaymentMethod == 'H', <see cref="IsAchPaymentMethod"/>). The store follows
    /// <c>CustomerSync:Source</c>, read per call (plan E2):
    /// <list type="bullet">
    /// <item><c>ods</c> (default): straight from ODS base.Customer, as before. PaymentMethod is not surfaced by the
    /// curated customer views, so the base table is read directly (current rows only), matched on CustomerId
    /// (== Customer.Id). One batched IN-query, like eSign.</item>
    /// <item><c>ctrm</c>: from dbo.Customer.PaymentMethod, which the ctrm customer sync fills from GraphQL
    /// <c>paymentMethod</c> - but only while <c>CustomerSync:CtrmExtendedFields</c> is on. With it off the column
    /// stays null, so on ctrm the badge simply shows for nobody. The ODS is never read on this path (a minted
    /// customer has no ODS row anyway).</item>
    /// </list>
    /// </summary>
    private async Task EnrichCustomersWithAchAsync(List<Customer> customers, CancellationToken cancellationToken = default)
    {
        if (customers.Count == 0) return;

        var ids = customers.Select(c => c.Id).Distinct().ToList();

        if (CustomerSyncSources.Resolve(_configuration) == CustomerSyncSources.Ctrm)
        {
            var codes = await _appContext.Customers
                .AsNoTracking()
                .Where(c => ids.Contains(c.Id) && c.PaymentMethod != null)
                .Select(c => new { c.Id, c.PaymentMethod })
                .ToListAsync(cancellationToken);
            MarkAch(customers, codes.Where(c => IsAchPaymentMethod(c.PaymentMethod)).Select(c => c.Id).ToHashSet());
            return;
        }

        var rows = await _context.CustomerPaymentInfos
            .AsNoTracking()
            .Where(p => p.IsCurrent && ids.Contains(p.CustomerId))
            .Select(p => new { p.CustomerId, p.PaymentMethod })
            .ToListAsync(cancellationToken);

        // 'H' = ACH enabled (PaymentMethod is trimmed on read via the entity's value conversion).
        var achIds = rows
            .Where(p => IsAchPaymentMethod(p.PaymentMethod))
            .Select(p => p.CustomerId)
            .ToHashSet();

        MarkAch(customers, achIds);
    }

    private static void MarkAch(List<Customer> customers, HashSet<long> achIds)
    {
        foreach (var customer in customers)
        {
            if (achIds.Contains(customer.Id)) customer.AchEnabled = true;
        }
    }

    /// <summary>
    /// Attaches each customer's active trade-unit codes: one Origination query for the whole list.
    /// </summary>
    /// <remarks>
    /// The planting-intention dialog needs exactly this, and used to fetch it on open. When CTRM is slow
    /// the browser's handful of connections to the API are all held by slow contract and ticket reads,
    /// so that small request queued behind them for 30 seconds or more. Carried on the list the page has
    /// already loaded, the dialog opens with no request at all.
    /// </remarks>
    private async Task EnrichCustomersWithTradeUnitsAsync(List<Customer> customers, CancellationToken cancellationToken = default)
    {
        if (customers.Count == 0) return;

        var ids = customers.Select(c => c.Id).Distinct().ToList();

        var rows = await _appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(t => t.IsActive && ids.Contains(t.CustomerId))
            .Select(t => new { t.CustomerId, t.TradeUnit })
            .ToListAsync(cancellationToken);

        var byCustomer = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.TradeUnit))
            .GroupBy(r => r.CustomerId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => r.TradeUnit.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(c => c, StringComparer.Ordinal).ToList());

        foreach (var customer in customers)
        {
            if (byCustomer.TryGetValue(customer.Id, out var codes)) customer.ActiveTradeUnits = codes;
        }
    }

    /// <summary>
    /// Calculates a relevance score for a customer name based on how well it matches the search terms.
    /// Higher scores indicate better matches.
    /// </summary>
    private static int CalculateRelevanceScore(string customerName, List<string> searchWords, string originalSearchTerm)
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

    public async Task<Customer?> GetByIdAsync(long id, CancellationToken cancellationToken)
    {
        return await _appContext.Customers.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
    }

    public async Task<Customer?> GetByScoularIdAsync(string scoularId, CancellationToken cancellationToken)
    {
        return await _appContext.Customers.AsNoTracking()
            .FirstOrDefaultAsync(c => c.ScoularId == scoularId, cancellationToken);
    }

    public async Task<List<Customer>> GetLinkedToAsync(string scoularId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(scoularId)) return [];

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
        await EnrichCustomersWithAchAsync(customers, cancellationToken);
        await EnrichCustomersWithTradeUnitsAsync(customers, cancellationToken);
        return customers;
    }


    /// <summary>Reconciles a producer's manual trade units to <paramref name="tradeUnitCodes"/>,
    /// onboarding the producer from the ODS when <paramref name="customerId"/> is not in
    /// dbo.Customer. Before inserting, it adopts an existing row with the candidate's ScoularId
    /// (trimmed, case-insensitive; minted or not) — preferring an active row, then the lowest id,
    /// the tie-break the ODS sync shares when it adopts by ScoularId (C3) — and reactivates it as manual if inactive,
    /// so one producer never ends up under two ids. The outcome's CustomerId is the id actually
    /// written to (Adopted = true when that differs from the request). E4 later adds the ScoularId
    /// to the request so the client never has to send an ODS id at all. An adoption is add-only:
    /// pre-existing active manual trade units on the adopted row are kept, because an onboarding
    /// request carries only the new codes.</summary>
    public async Task<AssignTradeUnitsOutcome> AssignTradeUnitsAsync(long customerId, List<string> tradeUnitCodes, string currentUser, CancellationToken cancellationToken)
    {
        // Normalize: trim, drop blanks, de-dupe (case-insensitive).
        var codes = tradeUnitCodes
            .Select(c => c?.Trim() ?? string.Empty)
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // Audit: this is a manual user action, so stamp the acting user's UPN (not "system").
        var now = DateTime.UtcNow;

        // Ensure the customer exists in dbo.Customer — insert from ODS if this is a
        // brand-new onboarding (producer with no contract/ticket).
        var customerExists = await _appContext.Customers
            .AnyAsync(c => c.Id == customerId, cancellationToken);

        // An empty set can't onboard a brand-new producer (nothing anchors the insert), but
        // for an existing producer it's a valid request to clear all manual assignments.
        if (!customerExists && codes.Count == 0) return AssignTradeUnitsOutcome.NoCodes(customerId);

        // True when the trade units land on an existing row found by ScoularId; from then on
        // customerId is that row's id, and everything below (reconcile, audit) runs against it.
        var adopted = false;
        if (!customerExists)
        {
            var candidate = await LoadOnboardingCandidateAsync(customerId, cancellationToken);
            if (candidate is null)
            {
                _logger.LogWarning("AssignTradeUnits: customer {CustomerId} not found in base.vw_CurrentCustomers", customerId);
                return AssignTradeUnitsOutcome.CustomerNotFound(customerId);
            }

            // The sync may already hold this producer under another id (a CTRM-minted 5e15+N row,
            // or any row carrying the same ScoularId). Adopt that row rather than insert a second
            // customer: a second row would split the producer's notes, contacts and saved lists.
            // Tie-break shared with the ODS sync adoption (C3): active first, then lowest id. Trim() on the
            // column for the InMemory provider (SQL Server ignores trailing spaces in '=' anyway);
            // the case variants likewise only matter there (the SQL collation ignores case).
            var codeVariants = ScoularIdQueryVariants(candidate.ScoularId).ToList();
            var heldByCode = codeVariants.Count == 0
                ? null
                : await _appContext.Customers
                    .Where(c => c.ScoularId != null && codeVariants.Contains(c.ScoularId.Trim()))
                    .OrderByDescending(c => c.IsActive)
                    .ThenBy(c => c.Id)
                    .FirstOrDefaultAsync(cancellationToken);

            if (heldByCode is not null)
            {
                var requestedId = customerId;
                adopted = true;
                customerId = heldByCode.Id;
                if (!heldByCode.IsActive)
                {
                    heldByCode.IsActive = true;
                    heldByCode.IsManual = true;
                }
                // Ids only — never the ScoularId or the name.
                _logger.LogInformation(
                    "AssignTradeUnits: requested id {RequestedId} adopted existing customer {CustomerId} by ScoularId (no second row inserted)",
                    requestedId, customerId);
            }
            else
            {
                candidate.IsManual = true;
                candidate.IsActive = true;
                _appContext.Customers.Add(candidate);
            }
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

        // Snapshot the active codes BEFORE the reconcile loops below mutate these entities in
        // place — the audit line needs the before/after pair, and by the time we log it the
        // objects have already been changed. AR-03 leans on attribution as its compensating
        // control, so this write in particular has to be reconstructable: it rewrites
        // dbo.CustomerTradeUnit, which is the table every other authorization decision reads.
        var beforeCodes = existingTus
            .Where(t => t.IsActive)
            .Select(t => t.TradeUnit)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

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
                    existingTu.ModifiedAt = now;
                    existingTu.ModifiedBy = currentUser;
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
                    CreatedAt  = now,
                    CreatedBy  = currentUser,
                });
            }
        }

        // Soft-deactivate manual assignments the user removed (active manual TUs not in the
        // desired set). The row is preserved so it can be re-added/reactivated later. Sync
        // assignments (IsManual=false) are never touched — they're locked in the UI.
        var deactivatedCodes = new List<string>();
        // Skipped on an adoption: the client posted the codes for an ODS candidate it thought was
        // NEW, not the adopted row's full manual list, so reconciling here would deactivate manual
        // trade units the user never saw (e.g. a minted row's "2190" when "1085" was onboarded).
        // Adoption is add-only; the next normal save of the dialog reconciles as usual.
        if (!adopted)
        {
            foreach (var existing in existingTus)
            {
                if (existing.IsManual && existing.IsActive && !desired.Contains(existing.TradeUnit))
                {
                    existing.IsActive = false;
                    existing.ModifiedAt = now;
                    existing.ModifiedBy = currentUser;
                    deactivatedCodes.Add(existing.TradeUnit);
                }
            }
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        // Structured AUDIT_UPDATE, matching the sibling DeactivateTradeUnitAsync below. This was
        // a bare LogInformation with no audit code and no acting user until H-071 (2026-09-21)
        // asked for one — AR-03 claimed "mutations are attributable (audit logging + ...)" while
        // the row stamps were there but the log was not queryable as an audit event. Same gap
        // H-062 found under AR-01 on the producer-details delete: verify a stated compensating
        // control per route rather than trusting the register.
        // On an adoption the resulting active set is the union, not the posted list.
        var afterCodes = adopted
            ? beforeCodes.Union(codes, StringComparer.OrdinalIgnoreCase).OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            : codes.OrderBy(c => c, StringComparer.OrdinalIgnoreCase);
        _logger.LogInformation(
            "Customer trade units reassigned [{ErrorCode}] [{ErrorCategory}]: CustomerId={CustomerId} User={User} Adopted={Adopted} Before=[{Before}] After=[{After}] Deactivated=[{Deactivated}]",
            "AUDIT_UPDATE", "DataMutation", customerId, currentUser, adopted,
            string.Join(", ", beforeCodes),
            string.Join(", ", afterCodes),
            string.Join(", ", deactivatedCodes.OrderBy(c => c, StringComparer.OrdinalIgnoreCase)));
        return AssignTradeUnitsOutcome.Ok(customerId, adopted);
    }

    public Task<List<CustomerTradeUnitMembership>> GetTradeUnitMembershipsAsync(long customerId, CancellationToken cancellationToken)
    {
        // All memberships for this producer — active AND previously-removed (soft-deactivated). The
        // dialog shows active ones as chips; inactive ones are offered as re-addable suggestions so a
        // user can undo a removal even for a TU that isn't in the entitlements catalog. (There's at
        // most one row per (CustomerId, TradeUnit), so a code is either active or inactive, not both.)
        // HasOpenActivity is left at its fail-safe default (true = locked): working it out costs a
        // contract and a ticket read, which only the edit-customer dialog needs - see GetTradeUnitsAsync.
        return _appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(t => t.CustomerId == customerId)
            .OrderBy(t => t.TradeUnit)
            .Select(t => new CustomerTradeUnitMembership { TradeUnit = t.TradeUnit, IsManual = t.IsManual, IsActive = t.IsActive })
            .ToListAsync(cancellationToken);
    }

    public async Task<List<CustomerTradeUnitMembership>> GetTradeUnitsAsync(long customerId, CancellationToken cancellationToken)
    {
        var memberships = await GetTradeUnitMembershipsAsync(customerId, cancellationToken);

        if (memberships.Count == 0) return memberships;

        // Tag each membership with HasOpenActivity so the dialog can show a LOCKED
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
            _logger.LogWarning(ex, "Open-activity check failed for customer {CustomerId}; keeping TUs locked (HasOpenActivity=true)", customerId);
            // Membership defaults HasOpenActivity = true, so memberships already fail safe here.
        }

        return memberships;
    }
    /// <summary>
    /// The trade units in which this producer still has open activity: an open purchase contract, or an
    /// unapplied ticket (U/L/C) within the last three years that survives the storage gate.
    /// </summary>
    /// <remarks>
    /// <para>Decides which trade-unit memberships are LOCKED - the edit dialog will not let a user remove
    /// one with open activity, and the nightly sync brings a user-deactivated one back if activity
    /// reappears. So this has to agree with what the producer screen shows.</para>
    ///
    /// <para>It therefore reads through the same switch-backed repositories the producer screen uses,
    /// rather than querying the ODS views directly as it once did. With <c>Ctrm:Source</c> set to
    /// <c>ctrm</c> that is CTRM; otherwise ODS - and either way it is the SAME rows the screen renders.
    /// The previous inline ODS query could disagree with a CTRM-backed screen: a contract CTRM shows as
    /// open would not lock its trade unit here, and the user could remove a membership the screen said
    /// was active.</para>
    ///
    /// <para>Rules preserved exactly: contracts contribute their trade unit only while OPEN (the
    /// repositories already normalise the Db2 min-date sentinel to null); tickets contribute their
    /// organization code only when unapplied, and both repositories already apply the ticket-type,
    /// consolidated, three-year and storage-gate rules to that set.</para>
    /// </remarks>
    public async Task<HashSet<string>> GetOpenActivityTradeUnitsAsync(string scoularId, CancellationToken cancellationToken)
    {
        var openTus = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var code = scoularId?.Trim();
        if (string.IsNullOrEmpty(code)) return openTus;

        // customerId is not needed when the code is supplied; both repositories use the code directly.
        //
        // SEQUENTIAL, deliberately. With Ctrm:Source = ods both repositories are the ODS ones, and
        // they share this scope's single OriginationDbContext. Running the two reads concurrently
        // (Task.WhenAll) made EF throw "a second operation was started on this context instance"
        // the moment the second query began. That took down the PROD customer sync on 2026-09-29
        // (bring-back pass, first run on the new build) and the trade-unit assign / remove actions
        // with it; QA never saw it because its CTRM repositories go over HTTP, which is thread-safe.
        // One read after the other costs a few hundred milliseconds per producer and is correct on
        // both sources.
        var contracts = await _contractRepository.GetByCustomerAsync(0, code, cancellationToken);
        var tickets = await _ticketRepository.GetUnappliedByCustomerAsync(0, code, cancellationToken);

        foreach (var c in contracts)
            if (c.ClosedDate is null && !string.IsNullOrWhiteSpace(c.TradeUnit))
                openTus.Add(c.TradeUnit.Trim());

        foreach (var t in tickets)
            if (!string.IsNullOrWhiteSpace(t.OrganizationCode))
                openTus.Add(t.OrganizationCode.Trim());

        return openTus;
    }

    public async Task<DeactivateTradeUnitResult> DeactivateDormantTradeUnitAsync(long customerId, string tradeUnit, string currentUser, CancellationToken cancellationToken)
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
        // Manual user action → stamp the acting user's UPN.
        row.IsActive = false;
        row.UserDeactivated = true;
        row.ModifiedAt = DateTime.UtcNow;
        row.ModifiedBy = currentUser;
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Dormant trade unit {TradeUnit} removed for customer {CustomerId} (user removal; UserDeactivated set) [{ErrorCode}] [{ErrorCategory}]",
            code, customerId, "AUDIT_UPDATE", "DataMutation");
        return DeactivateTradeUnitResult.Ok;
    }

    public async Task<HashSet<long>> GetActiveCustomerIdsInTradeUnitsAsync(IReadOnlyCollection<string> tradeUnits, CancellationToken cancellationToken)
    {
        return await _appContext.CustomerTradeUnits
            .Where(ctu => tradeUnits.Contains(ctu.TradeUnit) && ctu.IsActive)
            .Select(ctu => ctu.CustomerId)
            .ToHashSetAsync(cancellationToken);
    }

    public async Task<string?> GetFirstActiveTradeUnitAsync(long customerId, CancellationToken cancellationToken)
    {
        // OrderBy makes "first" deterministic; without it SQL Server returns storage order, which
        // tagged multi-TU producers' records to whichever membership row happened to be inserted first.
        return await _appContext.CustomerTradeUnits
            .Where(ctu => ctu.CustomerId == customerId && ctu.IsActive)
            .OrderBy(ctu => ctu.TradeUnit)
            .Select(ctu => ctu.TradeUnit)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<List<string>> GetActiveTradeUnitCodesAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(ctu => ctu.CustomerId == customerId && ctu.IsActive)
            .OrderBy(ctu => ctu.TradeUnit)
            .Select(ctu => ctu.TradeUnit)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetAllActiveTradeUnitCodesAsync(CancellationToken cancellationToken)
    {
        return await _appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(ctu => ctu.IsActive)
            .Select(ctu => ctu.TradeUnit)
            .Distinct()
            .OrderBy(t => t)
            .ToListAsync(cancellationToken);
    }

    /// <summary>The producer to onboard for an id not yet in dbo.Customer: a single
    /// base.vw_CurrentCustomers row by CustomerId, mapped to Customer (null when absent). A seam:
    /// the raw ODS SQL cannot run on the InMemory provider, and E4 later re-routes onboarding to
    /// CTRM.</summary>
    protected virtual async Task<Customer?> LoadOnboardingCandidateAsync(long customerId, CancellationToken cancellationToken)
    {
        var row = await GetOdsCustomerRowAsync(customerId, cancellationToken);
        return row is null ? null : MapOdsRowToCustomer(row);
    }

    /// <summary>Reads a single producer row from base.vw_CurrentCustomers by CustomerId.</summary>
    private async Task<OdsCustomerRow?> GetOdsCustomerRowAsync(long customerId, CancellationToken cancellationToken)
    {
        var rows = await _context.Database
            .SqlQueryRaw<OdsCustomerRow>(@"
                SELECT TOP 1
                    c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1, c.IndustryCode2, c.NopIdNumber,
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
}
