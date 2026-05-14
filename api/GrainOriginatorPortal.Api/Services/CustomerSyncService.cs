using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using GrainOriginatorPortal.Api.Data;
using GrainOriginatorPortal.Api.Models;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Syncs dbo.Customer and dbo.CustomerTradeUnit from
/// originations.vw_CustomerTradeUnits in ODS.
///
/// Upsert + soft-delete pattern (no full DELETE+INSERT):
///   - Customers present in ODS are inserted or updated; IsActive reset to 1.
///   - CustomerTradeUnit pairs present in ODS are inserted or refreshed.
///   - Customers / pairs no longer in ODS have IsActive set to 0
///     (soft-delete preserves FKs from Notes / ProducerDetails / etc.).
///
/// Designed to be callable from both the scheduled
/// <see cref="CustomerSyncBackgroundService"/> and from the dev-only
/// diagnostics manual-trigger endpoint.
/// </summary>
public class CustomerSyncService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CustomerSyncService> _logger;

    public CustomerSyncService(IServiceScopeFactory scopeFactory, ILogger<CustomerSyncService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task<CustomerSyncResult> SyncAsync(CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var phase = Stopwatch.StartNew();
        var result = new CustomerSyncResult();

        using var scope = _scopeFactory.CreateScope();
        var odsDb = scope.ServiceProvider.GetRequiredService<OriginationDbContext>();
        var appDb = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        _logger.LogInformation("CustomerSync starting");

        // ── Load source rows from ODS ──
        phase.Restart();
        var odsRows = await odsDb.CustomerTradeUnits.AsNoTracking().ToListAsync(cancellationToken);
        _logger.LogInformation("CustomerSync loaded {Count} rows from ODS vw_CustomerTradeUnits ({Ms} ms)", odsRows.Count, phase.ElapsedMilliseconds);

        // ── Distinct customers from the ODS rows ──
        // The view has one row per (CustomerId, TradeUnit); customer attributes are
        // identical across the rows for a given CustomerId, so we collapse to the
        // first row per group for the customer-level upsert.
        phase.Restart();
        var odsCustomersByCustomerId = odsRows
            .GroupBy(o => o.CustomerId)
            .ToDictionary(g => g.Key, g => g.First());
        _logger.LogInformation("CustomerSync grouped {Count} distinct customers from ODS ({Ms} ms)", odsCustomersByCustomerId.Count, phase.ElapsedMilliseconds);

        // ── Load existing app-DB state (tracked, since we'll mutate) ──
        phase.Restart();
        var appCustomers = await appDb.Customers.ToListAsync(cancellationToken);
        var appCustomersById = appCustomers.ToDictionary(c => c.Id);
        _logger.LogInformation("CustomerSync loaded {Count} Customer rows from app DB ({Ms} ms)", appCustomers.Count, phase.ElapsedMilliseconds);

        phase.Restart();
        var appTradeUnits = await appDb.CustomerTradeUnits.ToListAsync(cancellationToken);
        var appTradeUnitsByKey = appTradeUnits
            .GroupBy(t => (t.CustomerId, t.TradeUnit))
            .ToDictionary(g => g.Key, g => g.First());
        _logger.LogInformation("CustomerSync loaded {Count} CustomerTradeUnit rows from app DB ({Ms} ms)", appTradeUnits.Count, phase.ElapsedMilliseconds);

        // ── Customer upserts ──
        phase.Restart();
        foreach (var (customerId, odsRow) in odsCustomersByCustomerId)
        {
            if (appCustomersById.TryGetValue(customerId, out var existing))
            {
                ApplyAttributes(existing, odsRow);
                if (!existing.IsActive)
                {
                    existing.IsActive = true;
                    result.CustomersReactivated++;
                }
                else
                {
                    result.CustomersUpdated++;
                }
            }
            else
            {
                var inserted = odsRow.ToCustomer();
                inserted.IsActive = true;
                appDb.Customers.Add(inserted);
                result.CustomersInserted++;
            }
        }

        // ── Customer soft-deletes (rows in app but no longer in ODS) ──
        foreach (var existing in appCustomers)
        {
            if (!odsCustomersByCustomerId.ContainsKey(existing.Id) && existing.IsActive)
            {
                existing.IsActive = false;
                result.CustomersDeactivated++;
            }
        }
        _logger.LogInformation(
            "CustomerSync Customer diff: {Inserted} ins, {Updated} upd, {Reactivated} reactivated, {Deactivated} deactivated ({Ms} ms)",
            result.CustomersInserted, result.CustomersUpdated,
            result.CustomersReactivated, result.CustomersDeactivated,
            phase.ElapsedMilliseconds);

        // ── CustomerTradeUnit upserts ──
        phase.Restart();
        var odsTradeUnitsByKey = odsRows
            .Where(o => !string.IsNullOrEmpty(o.TradeUnit))
            .GroupBy(o => (o.CustomerId, TradeUnit: o.TradeUnit!))
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var ((customerId, tradeUnit), odsRow) in odsTradeUnitsByKey)
        {
            if (appTradeUnitsByKey.TryGetValue((customerId, tradeUnit), out var existing))
            {
                if (existing.IsActive != odsRow.IsActive)
                {
                    existing.IsActive = odsRow.IsActive;
                    result.TradeUnitsUpdated++;
                }
            }
            else
            {
                appDb.CustomerTradeUnits.Add(new CustomerTradeUnit
                {
                    CustomerId = customerId,
                    TradeUnit  = tradeUnit,
                    IsActive   = odsRow.IsActive
                });
                result.TradeUnitsInserted++;
            }
        }

        // ── CustomerTradeUnit soft-deletes ──
        foreach (var existing in appTradeUnits)
        {
            var key = (existing.CustomerId, existing.TradeUnit);
            if (!odsTradeUnitsByKey.ContainsKey(key) && existing.IsActive)
            {
                existing.IsActive = false;
                result.TradeUnitsDeactivated++;
            }
        }
        _logger.LogInformation(
            "CustomerSync CustomerTradeUnit diff: {Inserted} ins, {Updated} upd, {Deactivated} deactivated ({Ms} ms)",
            result.TradeUnitsInserted, result.TradeUnitsUpdated, result.TradeUnitsDeactivated,
            phase.ElapsedMilliseconds);

        // ── Persist ──
        // SaveChangesAsync wraps its writes in an implicit transaction, and the
        // ApplicationDbContext has EnableRetryOnFailure configured, so the
        // automatic execution strategy will retry transient Azure SQL failures.
        // No explicit BeginTransaction is needed (and using one would conflict
        // with the retrying execution strategy).
        phase.Restart();
        _logger.LogInformation("CustomerSync calling SaveChangesAsync — this can take a while for large change sets");
        await appDb.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("CustomerSync SaveChanges done ({Ms} ms)", phase.ElapsedMilliseconds);

        sw.Stop();
        result.ElapsedMs = sw.ElapsedMilliseconds;
        result.CompletedAtUtc = DateTime.UtcNow;

        _logger.LogInformation(
            "CustomerSync completed in {ElapsedMs} ms. " +
            "Customers: {CustomersInserted} inserted, {CustomersUpdated} updated, " +
            "{CustomersReactivated} reactivated, {CustomersDeactivated} deactivated. " +
            "TradeUnits: {TradeUnitsInserted} inserted, {TradeUnitsUpdated} updated, " +
            "{TradeUnitsDeactivated} deactivated.",
            result.ElapsedMs,
            result.CustomersInserted, result.CustomersUpdated,
            result.CustomersReactivated, result.CustomersDeactivated,
            result.TradeUnitsInserted, result.TradeUnitsUpdated,
            result.TradeUnitsDeactivated);

        return result;
    }

    /// <summary>
    /// Copies ODS-sourced attribute values onto an existing tracked Customer.
    /// Customer.Id is not touched (it's the PK / FK target).
    /// </summary>
    private static void ApplyAttributes(Customer target, CustomerTradeUnitView source)
    {
        target.Name                  = source.CustomerName ?? string.Empty;
        target.ScoularId             = source.ScoularId;
        target.IndustryCode1         = source.IndustryCode1;
        target.EffectiveStartDate    = source.EffectiveStartDate;
        target.EffectiveEndDate      = source.EffectiveEndDate;
        target.Phone                 = source.MerchandisingPhone;
        target.Email                 = source.MerchandisingEmail;
        target.ExtendedPrimaryPhone  = source.ExtendedPrimaryPhone;
        target.SupplementalEmail     = source.SupplementalEmail;
        target.Location              = source.MerchandisingCity;
        target.StateProvince         = source.MerchandisingStateProvince;
        target.AddressLine1          = source.MerchandisingAddressLine1;
        target.PostalCode            = source.MerchandisingPostalCode;
        target.ExtendedAddressLine1  = source.ExtendedAddressLine1;
        target.ExtendedAddressLine2  = source.ExtendedAddressLine2;
        target.ExtendedAddressLine3  = source.ExtendedAddressLine3;
        target.ExtendedAddressLine4  = source.ExtendedAddressLine4;
        target.ExtendedCity          = source.ExtendedCity;
        target.ExtendedPostalCode    = source.ExtendedPostalCode;
        target.ExtendedStateProvince = source.ExtendedStateProvince;
        target.ExtendedCountry       = source.ExtendedCountry;
    }
}

/// <summary>Counts and timing for a single sync run.</summary>
public class CustomerSyncResult
{
    public int CustomersInserted    { get; set; }
    public int CustomersUpdated     { get; set; }
    public int CustomersReactivated { get; set; }
    public int CustomersDeactivated { get; set; }
    public int TradeUnitsInserted    { get; set; }
    public int TradeUnitsUpdated     { get; set; }
    public int TradeUnitsDeactivated { get; set; }
    public long ElapsedMs        { get; set; }
    public DateTime CompletedAtUtc { get; set; }
}
