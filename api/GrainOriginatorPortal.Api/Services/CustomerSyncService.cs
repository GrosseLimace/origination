using System.Diagnostics;
using Microsoft.Data.SqlClient;
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
                // Graduation: a customer present in the ODS view is backed by a real
                // contract/ticket, so they're no longer a user-added prospect. Clear the manual
                // flag so IsManual cleanly means "added by a user, no activity yet". From here
                // they follow the normal synced lifecycle (the main soft-delete deactivates them
                // if they later drop out of the view).
                if (existing.IsManual) existing.IsManual = false;
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
        // Skip IsManual rows: those were onboarded by a user (producers with no
        // contract/ticket, so they never appear in the ODS view) and must survive
        // nightly runs. Everything the sync itself created is IsManual=false and
        // behaves exactly as before.
        foreach (var existing in appCustomers)
        {
            if (!odsCustomersByCustomerId.ContainsKey(existing.Id) && existing.IsActive && !existing.IsManual)
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
                var changed = false;
                if (existing.IsActive != odsRow.IsActive)
                {
                    existing.IsActive = odsRow.IsActive;
                    changed = true;
                }
                // A TU present in the ODS view is backed by a real contract/ticket, so it's a
                // synced membership now — not a manual one. Clear the manual flag so it follows
                // the normal sync lifecycle going forward (e.g. auto-deactivates if that activity
                // later ages off). Purely-manual assignments never reach here (they're not in the
                // view), so they keep IsManual=true and stay protected.
                if (existing.IsManual)
                {
                    existing.IsManual = false;
                    changed = true;
                }
                if (changed) result.TradeUnitsUpdated++;
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
        // Skip IsManual rows — user-assigned trade units aren't in the ODS view, so
        // without this guard the nightly run would deactivate every manual assignment.
        foreach (var existing in appTradeUnits)
        {
            var key = (existing.CustomerId, existing.TradeUnit);
            if (!odsTradeUnitsByKey.ContainsKey(key) && existing.IsActive && !existing.IsManual)
            {
                existing.IsActive = false;
                result.TradeUnitsDeactivated++;
            }
        }
        _logger.LogInformation(
            "CustomerSync CustomerTradeUnit diff: {Inserted} ins, {Updated} upd, {Deactivated} deactivated ({Ms} ms)",
            result.TradeUnitsInserted, result.TradeUnitsUpdated, result.TradeUnitsDeactivated,
            phase.ElapsedMilliseconds);

        // ── Manual-producer refresh pass ──
        // Manually-onboarded producers (IsManual) that have no contract/ticket never appear
        // in vw_CustomerTradeUnits, so the loops above can't refresh them. They DO live in the
        // full customer master base.vw_CurrentCustomers (the same view onboarding reads), so
        // refresh their attributes from there and soft-delete any that have dropped out of the
        // master entirely. Producers already handled above (present in the TU view this run —
        // e.g. a manual producer who has since "graduated" by getting activity) are excluded
        // here, so each customer is touched by exactly one pass per run.
        phase.Restart();
        var manualOutsideView = appCustomers
            .Where(c => c.IsManual && !odsCustomersByCustomerId.ContainsKey(c.Id))
            .ToList();

        if (manualOutsideView.Count > 0)
        {
            // base.vw_CurrentCustomers is a heavy view (~20s even for a single id), so give it
            // a generous timeout — matches the 120s used for other heavy ODS reads and keeps a
            // slow night from cancelling this query at the 30s default. Nightly job, off the
            // request path, so the longer ceiling is harmless.
            odsDb.Database.SetCommandTimeout(120);
            var idCsv = string.Join(",", manualOutsideView.Select(c => c.Id));
            var masterRows = await odsDb.Database
                .SqlQueryRaw<CurrentCustomerRow>(@"
                    SELECT
                        c.CustomerId, c.ScoularId, c.CustomerName, c.IndustryCode1,
                        c.MerchandisingCity, c.MerchandisingStateProvince, c.MerchandisingAddressLine1, c.MerchandisingPostalCode,
                        c.MerchandisingPhone, c.MerchandisingEmail, c.ExtendedPrimaryPhone, c.SupplementalEmail,
                        c.ExtendedAddressLine1, c.ExtendedAddressLine2, c.ExtendedAddressLine3, c.ExtendedAddressLine4,
                        c.ExtendedCity, c.ExtendedPostalCode, c.ExtendedStateProvince, c.ExtendedCountry,
                        c.EffectiveStartDate, c.EffectiveEndDate
                    FROM base.vw_CurrentCustomers c
                    WHERE c.CustomerId IN (SELECT TRY_CAST(value AS bigint) FROM STRING_SPLIT(@ids, ','))",
                    new SqlParameter("@ids", idCsv))
                .ToListAsync(cancellationToken);
            var masterById = masterRows.ToDictionary(r => r.CustomerId);

            foreach (var existing in manualOutsideView)
            {
                if (masterById.TryGetValue(existing.Id, out var row))
                {
                    ApplyAttributes(existing, row);
                    if (!existing.IsActive)
                    {
                        existing.IsActive = true;
                        result.ManualCustomersReactivated++;
                    }
                    else
                    {
                        result.ManualCustomersRefreshed++;
                    }
                }
                else if (existing.IsActive)
                {
                    // Gone from the current-customer master → genuinely removed in CTRM.
                    // Soft-delete preserves FKs from Notes / ProducerDetails / etc.
                    existing.IsActive = false;
                    result.ManualCustomersDeactivated++;
                }
            }
        }
        _logger.LogInformation(
            "CustomerSync manual-producer refresh: {Checked} checked, {Refreshed} refreshed, {Reactivated} reactivated, {Deactivated} deactivated ({Ms} ms)",
            manualOutsideView.Count, result.ManualCustomersRefreshed,
            result.ManualCustomersReactivated, result.ManualCustomersDeactivated,
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
            "{TradeUnitsDeactivated} deactivated. " +
            "Manual producers: {ManualRefreshed} refreshed, {ManualReactivated} reactivated, " +
            "{ManualDeactivated} deactivated.",
            result.ElapsedMs,
            result.CustomersInserted, result.CustomersUpdated,
            result.CustomersReactivated, result.CustomersDeactivated,
            result.TradeUnitsInserted, result.TradeUnitsUpdated,
            result.TradeUnitsDeactivated,
            result.ManualCustomersRefreshed, result.ManualCustomersReactivated,
            result.ManualCustomersDeactivated);

        return result;
    }

    /// <summary>
    /// Copies ODS-sourced attribute values onto an existing tracked Customer.
    /// Customer.Id is not touched (it's the PK / FK target). Accepts either ODS source
    /// (the trade-unit view or the current-customers view) via the shared interface.
    /// </summary>
    private static void ApplyAttributes(Customer target, ICustomerOdsAttributes source)
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

    /// <summary>Row shape for the base.vw_CurrentCustomers read in the manual-producer refresh
    /// pass. Property names match the selected columns so EF's SqlQueryRaw can bind them, and
    /// it implements <see cref="ICustomerOdsAttributes"/> so it shares <see cref="ApplyAttributes"/>.</summary>
    private sealed class CurrentCustomerRow : ICustomerOdsAttributes
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
    public int ManualCustomersRefreshed    { get; set; }
    public int ManualCustomersReactivated  { get; set; }
    public int ManualCustomersDeactivated  { get; set; }
    public long ElapsedMs        { get; set; }
    public DateTime CompletedAtUtc { get; set; }
}
