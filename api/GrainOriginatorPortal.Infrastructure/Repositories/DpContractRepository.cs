using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using static GrainOriginatorPortal.Infrastructure.Data.SqlSanitization;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <inheritdoc />
public class DpContractRepository : IDpContractRepository
{
    // DpOdsDbContext, not OriginationDbContext: same ODS mappings, but its connection can be pointed
    // at an environment that actually HAS DP data (see DpOdsDbContext for why and how to revert).
    private readonly DpOdsDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<DpContractRepository> _logger;

    public DpContractRepository(
        DpOdsDbContext context,
        ApplicationDbContext appContext,
        ILogger<DpContractRepository> logger)
    {
        _context = context;
        _appContext = appContext;
        _logger = logger;
    }

    // Latest DP snapshot, one row per (trade unit, ticket, sequence, contract, customer).
    // Callers append "AND ..." (the base query already has WHERE rn = 1). Reads only from ODS
    // (ctrm.vw_GNTA70D1); CustomerId is filled in C# afterwards because dbo.Customer lives in the app
    // DB (Azure SQL has no cross-database joins), and Bushels because the unit-conversion rules are
    // branchy enough to want unit tests.
    //
    // No location: the view carries no elevator or facility code, so the only signal is the trade
    // unit the user already selected — a column that restates the filter. Showing a real delivery
    // point needs the elevator code added to the ODS view first.
    //
    // Every column in this view is CHAR-padded and declared NOT NULL, so trimming is mandatory and
    // ISNULL is not: an "absent" value arrives as blanks (text) or a floor date, not as NULL.
    //
    // ROW_NUMBER dedupe: the report can in principle emit more than one Report_Mode per run, which
    // would double-count a position. Partitioning on the natural key and keeping the first
    // Report_Line collapses that. Confirm the Report_Mode domain once prod data is available — an
    // explicit mode filter would be cheaper than the window function.
    private const string DpContractSql = """
        WITH LatestDp AS (
            SELECT
                Trade_Unit_Code,
                Commodity_Code,
                Contract_Prefix_Type,
                Contract_Prefix_Cmdy,
                Contract_Number,
                Contract_Suffix,
                Ticket_Prefix,
                Ticket_Number,
                Ticket_Suffix,
                Sequence_Number,
                Bol_Date,
                Customer_Id,
                Net_Quantity,
                Gross_Quantity,
                Quantity_Uom,
                Storage_Program_Code,
                Storage_Days,
                Decide_Free_Days,
                Storage_Rate,
                Receivable_Amount,
                Prepaid_Amount,
                Unearned_Storage_Amt,
                Unpaid_Handling_Amt,
                Initial_Storage_Date,
                Charged_From_Date,
                Charged_Thru_Date,
                Paid_Thru_Date,
                Status,
                Status_Description,
                Storage_Error_Flag,
                Storage_Error_Desc,
                Ticket_Status,
                -- A delivery carries one row per CHARGE PERIOD, and the period is what makes each row
                -- distinct — NOT Status. Real prod case: one ticket with two rows both Status='S'
                -- ("REGULAR STG RATE"), the first a zero-rate free window (2023-10-09→2024-01-31,
                -- $0.00) and the second the actual accrual (2024-02-01→2026-08-12, $782.13).
                -- Partitioning on Status collapsed those two and kept the $0.00 row, silently
                -- discarding the money. Charged_From/Thru_Date must therefore be in the key.
                ROW_NUMBER() OVER (
                    PARTITION BY Trade_Unit_Code, Ticket_Prefix, Ticket_Number, Ticket_Suffix,
                                 Sequence_Number, Contract_Number, Contract_Suffix, Customer_Id,
                                 Status, Charged_From_Date, Charged_Thru_Date
                    ORDER BY Report_Line
                ) AS rn
            FROM ctrm.vw_GNTA70D1
            WHERE Report_Run_Stamp = (SELECT MAX(Report_Run_Stamp) FROM ctrm.vw_GNTA70D1)
              AND Net_Quantity > 0
        )
        SELECT
            -- One PHYSICAL delivery. A ticket carries one row per charge type (confirmed in prod:
            -- Status '2' = flat initial charge, Status 'S' = accruing regular storage rate), and every
            -- one of those rows repeats the SAME Net_Quantity. Aggregations must therefore count
            -- bushels once per TicketKey — summing across rows double-counts the grain. Charge
            -- AMOUNTS, by contrast, are additive across rows.
            LTRIM(RTRIM(dp.Ticket_Prefix)) + '|' + LTRIM(RTRIM(dp.Ticket_Number)) + '|'
              + LTRIM(RTRIM(dp.Ticket_Suffix)) + '|' + CAST(dp.Sequence_Number AS varchar(20)) + '|'
              + LTRIM(RTRIM(dp.Trade_Unit_Code))                              AS TicketKey,
            -- Row identity = delivery + charge type. Must be unique for the Angular @for track.
            -- Includes the charge period: Status alone is NOT unique per row (a delivery can have two
            -- 'S' rows for different periods), which produced duplicate keys in the Angular @for track.
            LTRIM(RTRIM(dp.Ticket_Prefix)) + '|' + LTRIM(RTRIM(dp.Ticket_Number)) + '|'
              + LTRIM(RTRIM(dp.Ticket_Suffix)) + '|' + CAST(dp.Sequence_Number AS varchar(20)) + '|'
              + LTRIM(RTRIM(dp.Trade_Unit_Code)) + '|' + LTRIM(RTRIM(dp.Status)) + '|'
              + CONVERT(varchar(10), dp.Charged_From_Date, 112)                   AS Id,
            LTRIM(RTRIM(dp.Ticket_Number))                                    AS TicketNumber,
            -- Business-facing contract identifier: prefix type + prefix commodity + number, run
            -- together with no separator (P + C + PL84649 = "PCPL84649"). Confirmed with the business
            -- 2026-08-05. The suffix is deliberately NOT part of the displayed id — it's carried
            -- separately in ContractSuffix for anyone who needs it.
            LTRIM(RTRIM(dp.Contract_Prefix_Type)) + LTRIM(RTRIM(dp.Contract_Prefix_Cmdy))
              + LTRIM(RTRIM(dp.Contract_Number))                              AS ContractNumber,
            LTRIM(RTRIM(dp.Contract_Prefix_Type))                             AS ContractPrefixType,
            LTRIM(RTRIM(dp.Contract_Prefix_Cmdy))                             AS ContractPrefixCommodity,
            LTRIM(RTRIM(dp.Contract_Suffix))                                  AS ContractSuffix,
            LTRIM(RTRIM(dp.Ticket_Status))                                    AS TicketStatus,
            CAST(0 AS bigint)                                                 AS CustomerId,
            LTRIM(RTRIM(dp.Customer_Id))                                      AS CustomerCode,
            LTRIM(RTRIM(dp.Trade_Unit_Code))                                  AS TradeUnitCode,
            LTRIM(RTRIM(dp.Commodity_Code))                                   AS Crop,
            dp.Net_Quantity                                                   AS Quantity,
            dp.Gross_Quantity                                                 AS GrossQuantity,
            UPPER(LTRIM(RTRIM(dp.Quantity_Uom)))                              AS QuantityUom,
            CAST(NULL AS decimal(18,4))                                       AS Bushels,
            dp.Storage_Days                                                   AS StorageDays,
            dp.Decide_Free_Days                                               AS DecideFreeDays,
            dp.Storage_Rate                                                   AS StorageRate,
            dp.Receivable_Amount                                              AS ReceivableAmount,
            dp.Prepaid_Amount                                                 AS PrepaidAmount,
            dp.Unearned_Storage_Amt                                           AS UnearnedStorageAmount,
            dp.Unpaid_Handling_Amt                                            AS UnpaidHandlingAmount,
            dp.Initial_Storage_Date                                           AS StorageStartDate,
            dp.Charged_From_Date                                              AS ChargedFromDate,
            dp.Charged_Thru_Date                                              AS ChargedThruDate,
            dp.Paid_Thru_Date                                                 AS PaidThruDate,
            dp.Bol_Date                                                       AS BolDate,
            LTRIM(RTRIM(dp.Status))                                           AS Status,
            LTRIM(RTRIM(dp.Status_Description))                               AS StatusDescription,
            LTRIM(RTRIM(dp.Storage_Program_Code))                             AS StorageProgramCode,
            LTRIM(RTRIM(dp.Storage_Error_Flag))                               AS StorageErrorFlag,
            LTRIM(RTRIM(dp.Storage_Error_Desc))                               AS StorageErrorDescription
        FROM LatestDp dp
        WHERE dp.rn = 1
        """;

    /// <inheritdoc />
    public async Task<List<DpContract>> GetAsync(IEnumerable<string>? tradeUnits, CancellationToken cancellationToken)
    {
        try
        {
            var tuList = tradeUnits?.ToList();
            List<DpContract> records;
            if (tuList is { Count: > 0 })
            {
                // Resolve the trade units to producers, then load ALL of their DP positions —
                // cross-TU, matching how Storage scopes (the scope is producers, not rows).
                var customerCodes = await _appContext.Customers
                    .AsNoTracking()
                    .Where(c => c.IsActive && c.ScoularId != null
                        && _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id && ctu.IsActive && tuList.Contains(ctu.TradeUnit)))
                    .Select(c => c.ScoularId!)
                    .ToListAsync(cancellationToken);

                if (customerCodes.Count == 0) return [];

                var csv = SanitizeCsv(customerCodes);
                var sql = DpContractSql + " AND LTRIM(RTRIM(dp.Customer_Id)) IN (SELECT value FROM STRING_SPLIT(@customerCsv, ','))";
                records = await _context.Database
                    .SqlQueryRaw<DpContract>(sql, new SqlParameter("@customerCsv", csv))
                    .ToListAsync(cancellationToken);
            }
            else
            {
                records = await _context.Database
                    .SqlQueryRaw<DpContract>(DpContractSql)
                    .ToListAsync(cancellationToken);
            }

            await EnrichWithCustomerIdsAsync(records, cancellationToken);
            await EnrichAsync(records, cancellationToken);
            return records;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving DP contracts");
            return [];
        }
    }

    /// <inheritdoc />
    public async Task<List<DpContract>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        try
        {
            // Look up the producer's source ID from dbo.Customer, then filter by it in ODS.
            var scoularId = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.Id == customerId && c.ScoularId != null)
                .Select(c => c.ScoularId!)
                .FirstOrDefaultAsync(cancellationToken);

            if (string.IsNullOrEmpty(scoularId)) return [];

            var sql = DpContractSql + " AND LTRIM(RTRIM(dp.Customer_Id)) = @customerCode";
            var records = await _context.Database
                .SqlQueryRaw<DpContract>(sql, new SqlParameter("@customerCode", scoularId))
                .ToListAsync(cancellationToken);

            // CustomerId is already known from the input — no lookup needed.
            foreach (var r in records) r.CustomerId = customerId;

            await EnrichAsync(records, cancellationToken);
            return records;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving DP contracts for customer {CustomerId}", customerId);
            return [];
        }
    }

    /// <summary>Looks up CustomerId for each DP record from the dbo.Customer table (Origination DB).</summary>
    private async Task EnrichWithCustomerIdsAsync(List<DpContract> records, CancellationToken cancellationToken)
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

    /// <summary>
    /// Fills the bushel quantity, which the ODS query cannot compute. Degrades to "no value" rather
    /// than failing the load — an unconvertible quantity should cost that one cell, not the whole tab.
    /// </summary>
    private async Task EnrichAsync(List<DpContract> records, CancellationToken cancellationToken)
    {
        if (records.Count == 0) return;

        await PopulateBushelsAsync(records, cancellationToken);
    }
    /// <summary>
    /// Converts each row's quantity to bushels using the ODS commodity conversion factors. Rows the
    /// conversion can't substantiate keep a null <see cref="DpContract.Bushels"/> so the UI shows a
    /// blank instead of a wrong number.
    /// </summary>
    private async Task PopulateBushelsAsync(List<DpContract> records, CancellationToken cancellationToken)
    {
        try
        {
            var conversions = await _context.CommodityConversions
                .AsNoTracking()
                .Where(c => c.LbsPerUnit > 0)
                .Select(c => new { c.CommodityCode, c.LbsPerUnit })
                .ToListAsync(cancellationToken);

            var lbsPerBushel = conversions
                .Where(c => !string.IsNullOrWhiteSpace(c.CommodityCode))
                .GroupBy(c => c.CommodityCode.Trim().ToUpperInvariant())
                .ToDictionary(g => g.Key, g => g.First().LbsPerUnit);

            foreach (var record in records)
            {
                record.Bushels = DpBushelConversion.ToBushels(
                    record.Quantity, record.QuantityUom, record.Crop, lbsPerBushel);
            }
        }
        catch (Exception ex)
        {
            // Leaves every Bushels null — the tab still lists positions, just without bushel figures.
            _logger.LogWarning(ex, "Commodity conversion lookup failed — DP contracts will load without bushel quantities");
        }
    }
}
