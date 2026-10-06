// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Infrastructure.Sync;

/// <summary>
/// The CTRM feeder: builds rows shaped like <c>originations.vw_CustomerTradeUnits</c> from the Scoular GraphQL
/// gateway, so <c>CustomerSyncService</c> runs the same passes it runs on the ODS feeder.
/// </summary>
/// <remarks>
/// <para><b>Customers.</b> Every producer code the app holds (<c>dbo.Customer.ScoularId</c>, active or not, manual or
/// not) is looked up in the CTRM customer master by <c>sourceCode</c> (<see cref="CtrmCustomerReader"/>). A customer
/// whose master row is found and passes the view's customer-level filters (<see cref="CtrmCustomerFilters"/>) is in;
/// one that is missing or filtered out gets no rows, so the service deactivates it, guarded, exactly as when it
/// drops out of the view.</para>
///
/// <para><b>Links.</b> The view derives a customer's trade units from its contracts and tickets over all time, and
/// those never go away, so a link once earned is permanent (plan D2). The app's own sync-sourced links
/// (<c>!IsManual &amp;&amp; IsActive</c>) therefore ARE the backfill and are re-asserted, trimmed, for every in-scope
/// customer. A customer whose only sync evidence is a user-removed (<c>UserDeactivated</c>) link gets one
/// presence-only row (<c>TradeUnit</c> null): it is still in the view on ODS, and the user's removal is left alone.
/// Rows are generated per <c>dbo.Customer</c> row, so two app rows sharing a code each keep their own links.</para>
///
/// <para><b>Manual producers.</b> An in-scope manual customer with no sync evidence lands in
/// <see cref="CustomerSyncSourceResult.ManualMaster"/> (refreshed, not graduated); one the master no longer holds is
/// left out with the master marked complete, so the service deactivates it as on ODS. A manual customer with no
/// code cannot be looked up at all and is <see cref="CustomerSyncSourceResult.ManualUnverifiable"/>.</para>
///
/// <para><b>Fails closed.</b> Any lookup failure returns <c>Ok = false</c> with NO rows - never a partial row set,
/// because every missing row is a deactivation - with a <c>CUSTOMER_SYNC_*</c> code and the lookup report attached
/// (the service copies <see cref="CustomerSyncSourceResult.Lookup"/> onto the run result even on abort).</para>
///
/// <para>Logs carry codes and counts only - never names, phones or addresses.</para>
/// </remarks>
public sealed class CtrmCustomerSyncSource : ICustomerSyncSource
{
    private const string NoPermissionCode = "CUSTOMER_SYNC_NO_PERMISSION";
    private const string SchemaMismatchCode = "CUSTOMER_SYNC_SCHEMA_MISMATCH";
    private const string SourceUnavailableCode = "CUSTOMER_SYNC_SOURCE_UNAVAILABLE";

    private readonly CtrmCustomerReader _customers;
    private readonly CtrmCustomerActivityReader _activity;
    private readonly ICustomerSyncRepository _repository;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmCustomerSyncSource> _logger;
    private readonly Func<DateTime> _today;

    public CtrmCustomerSyncSource(
        CtrmCustomerReader customers,
        CtrmCustomerActivityReader activity,
        ICustomerSyncRepository repository,
        IConfiguration configuration,
        ILogger<CtrmCustomerSyncSource> logger,
        Func<DateTime>? today = null)
    {
        _customers = customers ?? throw new ArgumentNullException(nameof(customers));
        _activity = activity ?? throw new ArgumentNullException(nameof(activity));
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _today = today ?? (() => DateTime.UtcNow.Date);
    }

    public string Name => CustomerSyncSources.Ctrm;

    public async Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions options, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(appState);
        ArgumentNullException.ThrowIfNull(options);

        var appCodes = appState.Customers
            .Select(c => c.ScoularId?.Trim())
            .Where(c => !string.IsNullOrEmpty(c))
            .Select(c => c!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var lookup = await _customers.GetBySourceCodesAsync(appCodes, cancellationToken);
        if (!lookup.Ok || lookup.Value is null)
            return LookupFailed(lookup, appCodes.Count);

        var master = lookup.Value;
        var lookupInfo = LookupInfo(lookup, master);

        var linksByCustomer = appState.TradeUnits.ToLookup(l => l.CustomerId);
        var rows = new List<CustomerSyncSourceRow>();
        var manualMaster = new Dictionary<long, CustomerSyncAttributes>();
        var unverifiable = new HashSet<long>();
        var outOfScope = new Dictionary<string, int>(StringComparer.Ordinal);
        var presenceOnly = 0;

        foreach (var customer in appState.Customers)
        {
            var code = customer.ScoularId?.Trim();
            if (string.IsNullOrEmpty(code))
            {
                if (customer.IsManual) unverifiable.Add(customer.Id);
                continue;
            }

            if (!master.ByCode.TryGetValue(code, out var dto)) continue;
            if (!CtrmCustomerFilters.IsInScope(dto, out var reason))
            {
                outOfScope[reason] = outOfScope.GetValueOrDefault(reason) + 1;
                continue;
            }

            var attributes = new CtrmCustomerSyncAttributes(dto);
            var links = linksByCustomer[customer.Id].ToList();
            var activeSyncLinks = links
                .Where(l => !l.IsManual && l.IsActive)
                .Select(l => l.TradeUnit.Trim())
                .Where(t => t.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            if (activeSyncLinks.Count > 0)
            {
                rows.AddRange(activeSyncLinks.Select(t => new CustomerSyncSourceRow { CustomerId = customer.Id, TradeUnit = t, Attributes = attributes }));
            }
            else if (links.Any(l => !l.IsManual && l.UserDeactivated))
            {
                rows.Add(new CustomerSyncSourceRow { CustomerId = customer.Id, TradeUnit = null, Attributes = attributes });
                presenceOnly++;
            }
            else if (customer.IsManual)
            {
                manualMaster[customer.Id] = attributes;
            }
        }

        _logger.LogInformation(
            "CustomerSync CTRM feeder: {Customers} app customer(s), {Codes} code(s) looked up ({Found} found, {Missing} missing); " +
            "{Rows} row(s) for {RowCustomers} customer(s) ({PresenceOnly} presence-only); {ManualMaster} manual customer(s) refreshed from the master, " +
            "{Unverifiable} manual customer(s) without a code; out of scope by reason: {OutOfScope}",
            appState.Customers.Count, lookupInfo.Requested, lookupInfo.Found, lookupInfo.Missing,
            rows.Count, rows.Select(r => r.CustomerId).Distinct().Count(), presenceOnly, manualMaster.Count,
            unverifiable.Count, Describe(outOfScope));

        return new CustomerSyncSourceResult
        {
            Source = Name,
            Rows = rows,
            ManualMaster = manualMaster,
            ManualMasterComplete = true,
            ManualUnverifiable = unverifiable,
            Lookup = lookupInfo
        };
    }

    /// <summary>
    /// A failed lookup: no rows, a <c>CUSTOMER_SYNC_*</c> code, and the lookup report. Order matters: a filter
    /// mismatch first; then a missing permission; then an HC0045 server timeout (a slow gateway, even though it
    /// arrives as a QueryError with HTTP 400); then a genuine HTTP 400 QueryError (a projection field or argument the
    /// API does not have); anything else is the source being unavailable.
    /// </summary>
    private CustomerSyncSourceResult LookupFailed(CtrmReadResult<CtrmCustomerLookup> lookup, int requested)
    {
        var permission = CtrmCustomerReader.DescribePermission(lookup);
        var code =
            lookup.ErrorCode == CtrmCustomerReader.FilterMismatchCode ? CtrmCustomerReader.FilterMismatchCode
            : permission == "missing" ? NoPermissionCode
            : CtrmServerTimeoutRetry.IsServerTimeout(lookup) ? SourceUnavailableCode
            : lookup.Status == CtrmReadStatus.QueryError && lookup.HttpStatus == 400 ? SchemaMismatchCode
            : SourceUnavailableCode;

        return new CustomerSyncSourceResult
        {
            Source = Name,
            Ok = false,
            FailureCode = code,
            FailureDetail = $"CTRM customer lookup failed ({lookup.Status}, HTTP {lookup.HttpStatus?.ToString() ?? "none"}); nothing read from CTRM is used this run. {lookup.Detail}",
            Lookup = new CustomerSyncLookupInfo
            {
                Status = lookup.Status.ToString(),
                Permission = permission,
                HttpStatus = lookup.HttpStatus,
                ErrorCode = lookup.ErrorCode,
                Detail = lookup.Detail,
                Requested = requested
            }
        };
    }

    private static CustomerSyncLookupInfo LookupInfo(CtrmReadResult<CtrmCustomerLookup> lookup, CtrmCustomerLookup master) => new()
    {
        Status = lookup.Status.ToString(),
        Permission = CtrmCustomerReader.DescribePermission(lookup),
        HttpStatus = lookup.HttpStatus,
        ErrorCode = lookup.ErrorCode,
        Detail = lookup.Detail,
        Requested = master.Requested,
        Found = master.Found,
        Missing = master.Missing,
        Duplicates = master.Duplicates,
        Requests = master.Requests
    };

    private static string Describe(Dictionary<string, int> counts) =>
        counts.Count == 0
            ? "none"
            : string.Join(", ", counts.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{p.Key}={p.Value}"));
}
