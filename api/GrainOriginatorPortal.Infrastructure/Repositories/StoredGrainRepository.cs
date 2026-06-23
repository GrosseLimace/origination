using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class StoredGrainRepository : IStoredGrainRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<StoredGrainRepository> _logger;

    public StoredGrainRepository(OriginationDbContext context, ApplicationDbContext appContext, ILogger<StoredGrainRepository> logger)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
    }

    // Latest warehouse-receipt row per (receipt, location, customer); tiebreaker S > D > F.
    // Callers append "AND ..." (the base query already has WHERE rn = 1). Reads only from ODS
    // (ctrm.vw_GNTA39D1); CustomerId is resolved in C# from dbo.Customer (Azure SQL has no cross-DB joins).
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

    public async Task<List<StoredGrain>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken)
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

    public async Task<List<StoredGrain>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
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
}
