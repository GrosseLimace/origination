using System.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Syncs dbo.Customer and dbo.CustomerTradeUnit from the customer-sync source chosen per run by
/// <c>CustomerSync:Source</c> (<see cref="CustomerSyncSources.Resolve"/>): the ODS feeder
/// (<see cref="OdsCustomerSyncSource"/> — originations.vw_CustomerTradeUnits plus base.vw_CurrentCustomers;
/// the default) or the CTRM GraphQL feeder (the literal <c>ctrm</c> opts in). Both feeders return rows
/// shaped like the ODS view, so one set of passes runs whichever is configured.
///
/// Upsert + soft-delete pattern (no full DELETE+INSERT):
///   - Customers present in the source rows are inserted or updated; IsActive reset to 1.
///   - CustomerTradeUnit pairs present in the source rows are inserted or refreshed.
///   - Customers / pairs no longer in the source rows have IsActive set to 0
///     (soft-delete preserves FKs from Notes / ProducerDetails / etc.).
///   - Manual producers outside the rows are refreshed from the source's customer-master lookup.
///   - User-removed dormant trade units come back once the producer has open activity again.
///
/// A source that reports failure (<see cref="CustomerSyncSourceResult.Ok"/> false) aborts the run
/// before any pass and before any write; read failures a source throws propagate unchanged.
///
/// Mass-deactivation guard (both sources): after the passes are computed and before SaveChanges,
/// <see cref="CustomerSyncGuard"/> refuses a run whose source came back empty while the app holds
/// active rows, or that would deactivate more customers or links than
/// <c>CustomerSync:MaxDeactivationCount</c> / <c>CustomerSync:MaxDeactivationPercent</c> allow. A tripped
/// guard aborts with <c>CUSTOMER_SYNC_SOURCE_EMPTY</c> / <c>CUSTOMER_SYNC_GUARD_TRIPPED</c>, logged at Error,
/// and nothing is written (the restart-during-an-ODS-outage failure in the outage recovery playbook).
/// <see cref="CustomerSyncOptions.Force"/> bypasses the guard for a legitimate mass change;
/// <see cref="CustomerSyncOptions.DryRun"/> computes everything and writes nothing.
///
/// Designed to be callable from both the scheduled
/// <see cref="CustomerSyncBackgroundService"/> and from the diagnostics manual-trigger endpoint.
/// </summary>
public class CustomerSyncService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CustomerSyncService> _logger;

    // Audit author for every sync-driven CustomerTradeUnit write (manual app actions stamp a user UPN).
    private const string SyncActor = "system";

    private const string GuardTrippedCode = "CUSTOMER_SYNC_GUARD_TRIPPED";
    private const string SourceEmptyCode = "CUSTOMER_SYNC_SOURCE_EMPTY";

    public CustomerSyncService(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<CustomerSyncService> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public Task<CustomerSyncResult> SyncAsync(CancellationToken cancellationToken = default) =>
        SyncAsync(CustomerSyncOptions.Default, cancellationToken);

    public async Task<CustomerSyncResult> SyncAsync(CustomerSyncOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(options);

        var sw = Stopwatch.StartNew();
        var phase = Stopwatch.StartNew();
        var result = new CustomerSyncResult { DryRun = options.DryRun };
        // One timestamp for every CustomerTradeUnit row this run touches, so a run's audit stamps are consistent.
        var syncTime = DateTime.UtcNow;

        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<ICustomerSyncRepository>();
        // Resolved in the same scope. Used by the bring-back pass to evaluate open activity with the
        // EXACT same rule the edit dialog uses.
        var customerRepository = scope.ServiceProvider.GetRequiredService<ICustomerRepository>();
        // The feeder comes from this run's scope too: sources hold the scoped sync repository.
        var source = scope.ServiceProvider.GetRequiredService<ICustomerSyncSourceFactory>()
            .Create(ResolveSourceName(options));
        result.Source = source.Name;

        _logger.LogInformation(
            "CustomerSync starting (source {Source}, trigger {Trigger}, dryRun {DryRun}, force {Force})",
            source.Name, options.Trigger, options.DryRun, options.Force);

        // ── Load existing app-DB state (tracked, since we'll mutate) ──
        // Loaded BEFORE the source, which receives these very list instances (read-only for it).
        phase.Restart();
        var appCustomers = await repo.LoadAppCustomersAsync(cancellationToken);
        var appCustomersById = appCustomers.ToDictionary(c => c.Id);
        _logger.LogInformation("CustomerSync loaded {Count} Customer rows from app DB ({Ms} ms)", appCustomers.Count, phase.ElapsedMilliseconds);

        phase.Restart();
        var appTradeUnits = await repo.LoadAppTradeUnitsAsync(cancellationToken);
        var appTradeUnitsByKey = appTradeUnits
            .GroupBy(t => (t.CustomerId, t.TradeUnit))
            .ToDictionary(g => g.Key, g => g.First());
        _logger.LogInformation("CustomerSync loaded {Count} CustomerTradeUnit rows from app DB ({Ms} ms)", appTradeUnits.Count, phase.ElapsedMilliseconds);

        // The guard judges deactivations against the active totals BEFORE any pass mutates them.
        var activeCustomersBefore = appCustomers.Count(c => c.IsActive);
        var activeLinksBefore = appTradeUnits.Count(t => t.IsActive);

        // ── Load source rows ──
        phase.Restart();
        var load = await source.LoadAsync(
            new CustomerSyncAppState { Customers = appCustomers, TradeUnits = appTradeUnits },
            new CustomerSyncLoadOptions { DryRun = options.DryRun, DiscoveryFrom = options.DiscoveryFrom },
            cancellationToken);
        // The source's own report travels with the result whether or not the source succeeded.
        result.CustomersMinted = load.CustomersMinted;
        result.Lookup = load.Lookup;
        result.Discovery = load.Discovery;
        if (!load.Ok)
        {
            result.Aborted = true;
            result.AbortCode = load.FailureCode;
            result.AbortReason = load.FailureDetail;
            _logger.LogError("[{ErrorCode}] [{ErrorCategory}] CustomerSync aborted before any write: {Detail}", load.FailureCode, "Integration", load.FailureDetail);
            return result;
        }
        var sourceRows = load.Rows;
        _logger.LogInformation("CustomerSync loaded {Count} rows from source {Source} ({Ms} ms)", sourceRows.Count, source.Name, phase.ElapsedMilliseconds);

        // ── Distinct customers from the source rows ──
        // One row per (CustomerId, TradeUnit); customer attributes are identical across the rows
        // for a given CustomerId, so we collapse to the first row per group for the customer-level
        // upsert (row order is preserved by the sources).
        phase.Restart();
        var sourceCustomersById = sourceRows
            .GroupBy(o => o.CustomerId)
            .ToDictionary(g => g.Key, g => g.First());
        _logger.LogInformation("CustomerSync grouped {Count} distinct customers from the source ({Ms} ms)", sourceCustomersById.Count, phase.ElapsedMilliseconds);

        // ── Customer upserts ──
        phase.Restart();
        foreach (var (customerId, sourceRow) in sourceCustomersById)
        {
            if (appCustomersById.TryGetValue(customerId, out var existing))
            {
                sourceRow.Attributes.ApplyTo(existing);
                // Graduation: a customer present in the source rows is backed by a real
                // contract/ticket, so they're no longer a user-added prospect. Clear the manual
                // flag so IsManual cleanly means "added by a user, no activity yet". From here
                // they follow the normal synced lifecycle (the main soft-delete deactivates them
                // if they later drop out of the source rows).
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
                // CreateNew sets Id, IsActive = true, IsManual = false, then applies every attribute.
                repo.AddCustomer(sourceRow.Attributes.CreateNew(customerId));
                result.CustomersInserted++;
            }
        }

        // ── Customer soft-deletes (rows in app but no longer in the source rows) ──
        // Skip IsManual rows: those were onboarded by a user (producers with no
        // contract/ticket, so they never appear in the source rows) and must survive
        // nightly runs. Everything the sync itself created is IsManual=false and
        // behaves exactly as before.
        foreach (var existing in appCustomers)
        {
            if (!sourceCustomersById.ContainsKey(existing.Id) && existing.IsActive && !existing.IsManual)
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
        // Keyed on the RAW trade-unit string; null and "" are customer-presence-only rows. Never
        // trimmed here: the ODS feeder passes the view's value verbatim (as the sync always read it)
        // and the CTRM feeder trims its own.
        phase.Restart();
        var sourceTradeUnitsByKey = sourceRows
            .Where(o => !string.IsNullOrEmpty(o.TradeUnit))
            .GroupBy(o => (o.CustomerId, TradeUnit: o.TradeUnit!))
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var (customerId, tradeUnit) in sourceTradeUnitsByKey.Keys)
        {
            if (appTradeUnitsByKey.TryGetValue((customerId, tradeUnit), out var existing))
            {
                // Respect an explicit user removal of a dormant locked TU: leave UserDeactivated
                // rows untouched here (do NOT reactivate or re-lock), even though the producer is
                // still in the source rows. The bring-back pass below restores them only once the
                // producer has open activity (contract/ticket) in that TU again.
                if (existing.UserDeactivated) continue;

                var changed = false;
                // Presence in the source rows IS the active signal — the ODS view no longer carries an
                // IsActive column (ODS dropped it from the underlying data 2026-08). Being here means
                // the producer has a real contract/ticket in this TU, and the soft-delete pass below
                // deactivates anything that drops out. This mirrors how Customer.IsActive is already
                // derived, so both levels now use one rule instead of two.
                if (!existing.IsActive)
                {
                    existing.IsActive = true;
                    changed = true;
                }
                // A TU present in the source rows is backed by a real contract/ticket, so it's a
                // synced membership now — not a manual one. Clear the manual flag so it follows
                // the normal sync lifecycle going forward (e.g. auto-deactivates if that activity
                // later ages off). Purely-manual assignments never reach here (they're not in the
                // source rows), so they keep IsManual=true and stay protected.
                if (existing.IsManual)
                {
                    existing.IsManual = false;
                    changed = true;
                }
                if (changed)
                {
                    existing.ModifiedAt = syncTime;
                    existing.ModifiedBy = SyncActor;
                    result.TradeUnitsUpdated++;
                }
            }
            else
            {
                repo.AddTradeUnit(new CustomerTradeUnit
                {
                    CustomerId = customerId,
                    TradeUnit  = tradeUnit,
                    IsActive   = true,   // in the source rows ⇒ active (see above)
                    CreatedAt  = syncTime,
                    CreatedBy  = SyncActor
                });
                result.TradeUnitsInserted++;
            }
        }

        // ── CustomerTradeUnit soft-deletes ──
        // Skip IsManual rows — user-assigned trade units aren't in the source rows, so
        // without this guard the nightly run would deactivate every manual assignment.
        foreach (var existing in appTradeUnits)
        {
            var key = (existing.CustomerId, existing.TradeUnit);
            if (!sourceTradeUnitsByKey.ContainsKey(key) && existing.IsActive && !existing.IsManual)
            {
                existing.IsActive = false;
                existing.ModifiedAt = syncTime;
                existing.ModifiedBy = SyncActor;
                result.TradeUnitsDeactivated++;
            }
        }
        _logger.LogInformation(
            "CustomerSync CustomerTradeUnit diff: {Inserted} ins, {Updated} upd, {Deactivated} deactivated ({Ms} ms)",
            result.TradeUnitsInserted, result.TradeUnitsUpdated, result.TradeUnitsDeactivated,
            phase.ElapsedMilliseconds);

        // ── Manual-producer refresh pass ──
        // Manually-onboarded producers (IsManual) that have no contract/ticket never appear in the
        // source rows, so the loops above can't refresh them. The source looked them up in its
        // customer master (on ODS: base.vw_CurrentCustomers, the same view onboarding reads) and
        // returned what it found in ManualMaster. Refresh their attributes from there and soft-delete
        // any that have dropped out of the master entirely — only when the source says its master
        // answer is complete, and never for ids it could not look up at all (ManualUnverifiable).
        // Producers already handled above (present in the source rows this run — e.g. a manual
        // producer who has since "graduated" by getting activity) are excluded here, so each
        // customer is touched by exactly one pass per run.
        phase.Restart();
        var manualOutsideRows = appCustomers
            .Where(c => c.IsManual && !sourceCustomersById.ContainsKey(c.Id) && !load.ManualUnverifiable.Contains(c.Id))
            .ToList();

        foreach (var existing in manualOutsideRows)
        {
            if (load.ManualMaster.TryGetValue(existing.Id, out var attributes))
            {
                attributes.ApplyTo(existing);
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
            else if (existing.IsActive && load.ManualMasterComplete)
            {
                // Gone from the current-customer master → genuinely removed in CTRM.
                // Soft-delete preserves FKs from Notes / ProducerDetails / etc.
                existing.IsActive = false;
                result.ManualCustomersDeactivated++;
            }
        }
        _logger.LogInformation(
            "CustomerSync manual-producer refresh: {Checked} checked, {Refreshed} refreshed, {Reactivated} reactivated, {Deactivated} deactivated ({Ms} ms)",
            manualOutsideRows.Count, result.ManualCustomersRefreshed,
            result.ManualCustomersReactivated, result.ManualCustomersDeactivated,
            phase.ElapsedMilliseconds);

        // ── Bring-back pass for user-removed dormant TUs ──
        // A CustomerTradeUnit with UserDeactivated=true was explicitly removed by a user while the
        // producer was dormant in that TU. The producer is usually STILL in the source rows, so the
        // upsert pass above deliberately left these rows alone. Here we re-check ONLY those rows
        // (a small set): if the producer now has open activity in that TU, we clear the flag and
        // restore it to a normal locked (sync-sourced) membership.
        //
        // IMPORTANT: we call ICustomerRepository.GetOpenActivityTradeUnitsAsync — the SAME method the edit
        // dialog uses to decide "dormant". Using one shared rule guarantees the dialog and the sync
        // agree: a TU the dialog showed as removable won't be silently restored on the next sync
        // unless the producer genuinely regained activity (no remove→resync→reappear loop).
        // Scoped to just the affected producers (small set), so it stays fast.
        phase.Restart();
        var deactivatedRows = appTradeUnits.Where(t => t.UserDeactivated).ToList();
        if (deactivatedRows.Count > 0)
        {
            // Compute each affected producer's open-activity TU set once (keyed by ScoularId).
            var openByScoular = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var custId in deactivatedRows.Select(r => r.CustomerId).Distinct())
            {
                if (!appCustomersById.TryGetValue(custId, out var cust) || string.IsNullOrEmpty(cust.ScoularId))
                    continue;
                if (!openByScoular.ContainsKey(cust.ScoularId))
                    openByScoular[cust.ScoularId] = await customerRepository.GetOpenActivityTradeUnitsAsync(cust.ScoularId, cancellationToken);
            }

            foreach (var row in deactivatedRows)
            {
                if (!appCustomersById.TryGetValue(row.CustomerId, out var cust) || string.IsNullOrEmpty(cust.ScoularId))
                    continue;
                if (openByScoular.TryGetValue(cust.ScoularId, out var openTus) && openTus.Contains(row.TradeUnit.Trim()))
                {
                    row.UserDeactivated = false;
                    row.IsActive = true;
                    row.IsManual = false;
                    row.ModifiedAt = syncTime;
                    row.ModifiedBy = SyncActor;
                    result.TradeUnitsBroughtBack++;
                }
            }
        }
        _logger.LogInformation(
            "CustomerSync bring-back pass: {Checked} user-removed rows checked, {BroughtBack} restored ({Ms} ms)",
            deactivatedRows.Count, result.TradeUnitsBroughtBack, phase.ElapsedMilliseconds);

        // ── Mass-deactivation guard ──
        // Every pass above only staged changes on tracked entities; nothing is written until
        // SaveChanges below. Returning before it (abort or dry run) persists nothing: the scope and
        // its DbContext are disposed with the staged changes.
        var verdict = CustomerSyncGuard.Evaluate(
            load.Rows.Count,
            activeCustomersBefore, result.CustomersDeactivated + result.ManualCustomersDeactivated,
            activeLinksBefore, result.TradeUnitsDeactivated,
            CustomerSyncGuardLimits.FromConfiguration(_configuration));
        result.Guard = verdict;
        if (verdict.Tripped)
        {
            if (!options.Force)
            {
                result.Aborted = true;
                result.AbortCode = verdict.SourceRows == 0 ? SourceEmptyCode : GuardTrippedCode;
                result.AbortReason = verdict.Reason;
                _logger.LogError(
                    "[{ErrorCode}] [{ErrorCategory}] CustomerSync aborted by the mass-deactivation guard, nothing written (source {Source}, dryRun {DryRun}): {Reason}",
                    result.AbortCode, "Integration", source.Name, options.DryRun, verdict.Reason);
                return result;
            }

            _logger.LogWarning(
                "[{ErrorCode}] [{ErrorCategory}] CustomerSync mass-deactivation guard bypassed by force (source {Source}): {Reason}",
                GuardTrippedCode, "Integration", source.Name, verdict.Reason);
        }

        if (options.DryRun)
        {
            sw.Stop();
            result.ElapsedMs = sw.ElapsedMilliseconds;
            result.CompletedAtUtc = DateTime.UtcNow;
            _logger.LogInformation("CustomerSync dry run — nothing persisted (source {Source}, {ElapsedMs} ms)", source.Name, result.ElapsedMs);
            return result;
        }

        // ── Persist ──
        // SaveChangesAsync wraps its writes in an implicit transaction, and the
        // ApplicationDbContext has EnableRetryOnFailure configured, so the
        // automatic execution strategy will retry transient Azure SQL failures.
        // No explicit BeginTransaction is needed (and using one would conflict
        // with the retrying execution strategy).
        phase.Restart();
        _logger.LogInformation("CustomerSync calling SaveChangesAsync — this can take a while for large change sets");
        await repo.SaveChangesAsync(cancellationToken);
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
    /// The configured source (<see cref="CustomerSyncSources.Resolve"/>), unless this is a dry run with a
    /// <see cref="CustomerSyncOptions.SourceOverride"/>: an override is honoured ONLY on a dry run, so Dev can
    /// exercise <c>ctrm</c> while the environment setting is still <c>ods</c> without ever writing from it.
    /// The override follows the same rule as the setting: only <c>ctrm</c> opts in.
    /// </summary>
    private string ResolveSourceName(CustomerSyncOptions options)
    {
        if (options.DryRun && !string.IsNullOrWhiteSpace(options.SourceOverride))
        {
            return string.Equals(options.SourceOverride.Trim(), CustomerSyncSources.Ctrm, StringComparison.OrdinalIgnoreCase)
                ? CustomerSyncSources.Ctrm
                : CustomerSyncSources.Ods;
        }

        return CustomerSyncSources.Resolve(_configuration);
    }
}

/// <summary>Per-run options for <see cref="CustomerSyncService.SyncAsync(CustomerSyncOptions, CancellationToken)"/>.</summary>
public sealed class CustomerSyncOptions
{
    /// <summary>Compute every pass and the guard verdict, then return without SaveChanges.</summary>
    public bool DryRun { get; init; }

    /// <summary>Bypass the mass-deactivation guard (admin, for a legitimate mass change). Never bypasses a failed source.</summary>
    public bool Force { get; init; }

    /// <summary><c>ods</c> or <c>ctrm</c>; honoured only together with <see cref="DryRun"/>.</summary>
    public string? SourceOverride { get; init; }

    /// <summary>Start of the CTRM discovery window instead of the configured trailing window.</summary>
    public DateTime? DiscoveryFrom { get; init; }

    /// <summary><c>"manual"</c> | <c>"startup"</c> | <c>"scheduled"</c>; the background service sets it.</summary>
    public string Trigger { get; init; } = "manual";

    public static readonly CustomerSyncOptions Default = new();
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
    public int TradeUnitsBroughtBack { get; set; }  // user-removed dormant TUs restored once activity returned
    public int ManualCustomersRefreshed    { get; set; }
    public int ManualCustomersReactivated  { get; set; }
    public int ManualCustomersDeactivated  { get; set; }
    public long ElapsedMs        { get; set; }
    public DateTime CompletedAtUtc { get; set; }

    /// <summary>The feeder this run read: <see cref="CustomerSyncSources.Ods"/> or <see cref="CustomerSyncSources.Ctrm"/>.</summary>
    public string Source { get; set; } = CustomerSyncSources.Ods;

    /// <summary>True when the run stopped before writing anything; <see cref="AbortCode"/> says why.</summary>
    public bool Aborted { get; set; }

    /// <summary>A CUSTOMER_SYNC_* code; null unless <see cref="Aborted"/>.</summary>
    public string? AbortCode { get; set; }

    /// <summary>Human-readable detail for the abort — codes and counts only, never names, phones or addresses.</summary>
    public string? AbortReason { get; set; }

    /// <summary>True when the run was a dry run: everything computed, nothing persisted.</summary>
    public bool DryRun { get; set; }

    /// <summary>The mass-deactivation guard's verdict; null when the run aborted before the passes.</summary>
    public CustomerSyncGuardVerdict? Guard { get; set; }

    /// <summary>Customers the source minted ids for this run (CTRM only).</summary>
    public int CustomersMinted { get; set; }

    /// <summary>The CTRM customer-master lookup report (CTRM only).</summary>
    public CustomerSyncLookupInfo? Lookup { get; set; }

    /// <summary>The CTRM link-discovery report (CTRM only).</summary>
    public CustomerSyncDiscoveryInfo? Discovery { get; set; }
}
