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
/// drops out of the view. The attributes copy the extended columns (email, extended address, NOP id - plan E1) only
/// when the lookup itself read them (<see cref="CtrmCustomerLookup.ExtendedFields"/>).</para>
///
/// <para><b>Links.</b> The view derives a customer's trade units from its contracts and tickets over all time, and
/// those never go away, so a link once earned is permanent (plan D2). The app's own sync-sourced links
/// (<c>!IsManual &amp;&amp; IsActive</c>) therefore ARE the backfill and are re-asserted for every in-scope customer,
/// in the table's own spelling (the service keys links on the raw string, so a padded stored unit is re-emitted
/// padded and a discovered unit that matches a held row by trimmed, case-insensitive value takes that row's
/// spelling). A customer the sync had deactivated that is back in scope gets all its non-manual, non-user-removed
/// links back, as the full-history view would restore them. A customer whose only sync evidence is a user-removed (<c>UserDeactivated</c>) link gets one
/// presence-only row (<c>TradeUnit</c> null): it is still in the view on ODS, and the user's removal is left alone.
/// Rows are generated per <c>dbo.Customer</c> row, so two app rows sharing a code each keep their own links.</para>
///
/// <para><b>Discovery.</b> New links come from every contract and ticket in a trailing window
/// (<see cref="CtrmCustomerActivityReader"/>; <see cref="DiscoveryWindowDaysKey"/>, overlapping so a missed night is
/// harmless). Discovery is additive only: a failed or partial read is logged as <c>CUSTOMER_SYNC_DISCOVERY_FAILED</c>
/// and the run carries on with the links it did return. A discovered code the app has never held is a new producer:
/// with an in-scope master row it gets an id from <c>dbo.CustomerIdSequence</c> (<see cref="CustomerIdMinting"/>;
/// <c>-1, -2, ...</c> placeholders on a dry run, which never reserves); otherwise it is counted as unknown.</para>
///
/// <para><b>Manual producers.</b> An in-scope manual customer with no sync evidence lands in
/// <see cref="CustomerSyncSourceResult.ManualMaster"/> (refreshed, not graduated), and so does a manual customer the
/// master returns but the filters reject (ODS parity: the ODS manual refresh has no scope filter); one the master no longer holds is
/// left out with the master marked complete, so the service deactivates it as on ODS. A manual customer with no
/// code cannot be looked up at all and is <see cref="CustomerSyncSourceResult.ManualUnverifiable"/>.</para>
///
/// <para><b>Fails closed.</b> Any lookup failure returns <c>Ok = false</c> with NO rows - never a partial row set,
/// because every missing row is a deactivation - with a <c>CUSTOMER_SYNC_*</c> code and the lookup and discovery
/// reports attached (the service copies them onto the run result even on abort). No id is reserved then.</para>
///
/// <para>Logs carry codes and counts only - never names, phones or addresses.</para>
/// </remarks>
public sealed class CtrmCustomerSyncSource : ICustomerSyncSource
{
    /// <summary>Days of contracts and tickets read for new links each run (default 7, clamped 1-3660).</summary>
    public const string DiscoveryWindowDaysKey = "CustomerSync:DiscoveryWindowDays";

    private const string NoPermissionCode = "CUSTOMER_SYNC_NO_PERMISSION";
    private const string SchemaMismatchCode = "CUSTOMER_SYNC_SCHEMA_MISMATCH";
    private const string SourceUnavailableCode = "CUSTOMER_SYNC_SOURCE_UNAVAILABLE";
    private const string DiscoveryFailedCode = "CUSTOMER_SYNC_DISCOVERY_FAILED";
    private const string UnknownCodesCode = "CUSTOMER_SYNC_UNKNOWN_CODES";

    /// <summary>A configured window wider than this reads more than a year of unfiltered activity every night.</summary>
    private const int WarnWindowDays = 366;

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

        // (1) Discovery first. Additive only: a failure is reported, never an abort.
        var (discovery, window) = await DiscoverAsync(options, cancellationToken);
        var discoveredByCode = discovery.All
            .GroupBy(l => l.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.Select(l => l.TradeUnit).Distinct(StringComparer.Ordinal).ToList(),
                StringComparer.OrdinalIgnoreCase);

        // (2) The codes the app holds, and the discovered codes it has never seen.
        var appCodes = appState.Customers
            .Select(c => c.ScoularId?.Trim())
            .Where(c => !string.IsNullOrEmpty(c))
            .Select(c => c!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var appCodeSet = appCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var newCodes = discoveredByCode.Keys
            .Where(c => !appCodeSet.Contains(c))
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToList();

        // (3) ONE master lookup for both. Any failure fails the whole run closed.
        var lookup = await _customers.GetBySourceCodesAsync([.. appCodes, .. newCodes], cancellationToken);
        if (!lookup.Ok || lookup.Value is null)
            return LookupFailed(lookup, appCodes.Count + newCodes.Count, DiscoveryInfo(window, discovery, newCodes.Count, unknownCodes: 0));

        var master = lookup.Value;
        var lookupInfo = LookupInfo(lookup, master);

        // (4) Known customers: their re-asserted links plus whatever was discovered for their code.
        var linksByCustomer = appState.TradeUnits.ToLookup(l => l.CustomerId);
        var rows = new List<CustomerSyncSourceRow>();
        var manualMaster = new Dictionary<long, CustomerSyncAttributes>();
        var unverifiable = new HashSet<long>();
        var outOfScope = new Dictionary<string, int>(StringComparer.Ordinal);
        var presenceOnly = 0;
        var discoveredRows = 0;
        var manualOutOfScope = 0;

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
                if (customer.IsManual)
                {
                    // ODS parity: the manual-producer refresh reads base.vw_CurrentCustomers by id with
                    // NO scope filter, so a manual producer the master still knows is refreshed and kept
                    // whatever its activeYN / industry / name says; only absence from the master
                    // deactivates one. Its sync links (if any) still drop with the customer's rows.
                    manualMaster[customer.Id] = new CtrmCustomerSyncAttributes(dto, master.ExtendedFields);
                    manualOutOfScope++;
                }
                continue;
            }

            var attributes = new CtrmCustomerSyncAttributes(dto, master.ExtendedFields);
            var links = linksByCustomer[customer.Id].ToList();

            // The table's own spelling of every unit this customer holds (active, inactive, manual or
            // user-removed), keyed by the trimmed, case-insensitive unit. The service keys trade-unit
            // rows on the RAW string (ODS parity) and UQ_CustomerTradeUnit_CustomerId_TradeUnit ignores
            // trailing spaces, so a stored " 1085 " must be re-emitted as " 1085 " and a discovered
            // "1085" must map onto it - a trimmed duplicate would deactivate the held row and then
            // collide on insert. Leading-space variants are collapsed onto whichever row came first.
            var storedSpelling = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in links)
            {
                var key = l.TradeUnit.Trim();
                if (key.Length > 0) storedSpelling.TryAdd(key, l.TradeUnit);
            }

            // Re-entry: a customer the sync deactivated comes back with every sync link it held,
            // as the full-history ODS view would restore them. User-removed links stay with the
            // bring-back pass; manual links stay manual.
            var reentering = !customer.IsActive;
            var reasserted = links
                .Where(l => !l.IsManual && !l.UserDeactivated && (l.IsActive || reentering) && l.TradeUnit.Trim().Length > 0)
                .Select(l => l.TradeUnit)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var reassertedKeys = reasserted.Select(t => t.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var discoveredOnly = discoveredByCode.TryGetValue(code, out var discoveredTradeUnits)
                ? discoveredTradeUnits
                    .Where(t => !reassertedKeys.Contains(t))
                    .Select(t => storedSpelling.TryGetValue(t, out var stored) ? stored : t)
                    .Distinct(StringComparer.Ordinal)
                    .ToList()
                : [];
            discoveredRows += discoveredOnly.Count;

            var tradeUnits = reasserted.Concat(discoveredOnly).ToList();
            if (tradeUnits.Count > 0)
            {
                rows.AddRange(tradeUnits.Select(t => new CustomerSyncSourceRow { CustomerId = customer.Id, TradeUnit = t, Attributes = attributes }));
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

        // (5) New producers: an in-scope master row earns an id; anything else is unknown, reported by count only.
        var toMint = newCodes
            .Where(c => master.ByCode.TryGetValue(c, out var dto) && CtrmCustomerFilters.IsInScope(dto, out _))
            .ToList();
        var unknownCodes = newCodes.Count - toMint.Count;
        if (unknownCodes > 0)
        {
            _logger.LogWarning(
                "CustomerSync CTRM feeder [{ErrorCode}] [{ErrorCategory}]: {Count} producer code(s) found in recent contracts/tickets are missing from the CTRM customer master or fail the customer filters; no customer is created for them.",
                UnknownCodesCode, "Integration", unknownCodes);
        }

        var ids = await IdsForNewProducersAsync(toMint.Count, options.DryRun, cancellationToken);
        for (var i = 0; i < toMint.Count; i++)
        {
            var attributes = new CtrmCustomerSyncAttributes(master.ByCode[toMint[i]], master.ExtendedFields);
            rows.AddRange(discoveredByCode[toMint[i]].Select(t => new CustomerSyncSourceRow { CustomerId = ids[i], TradeUnit = t, Attributes = attributes }));
        }

        _logger.LogInformation(
            "CustomerSync CTRM feeder: {Customers} app customer(s), {Codes} code(s) looked up ({Found} found, {Missing} missing); " +
            "{Rows} row(s) for {RowCustomers} customer(s) ({PresenceOnly} presence-only, {DiscoveredRows} from discovered links); " +
            "{NewCodes} new code(s): {Minted} minted (dry run {DryRun}), {Unknown} unknown; {ManualMaster} manual customer(s) refreshed from the master, {ManualOutOfScope} of them out of scope, " +
            "{Unverifiable} manual customer(s) without a code; out of scope by reason: {OutOfScope}",
            appState.Customers.Count, lookupInfo.Requested, lookupInfo.Found, lookupInfo.Missing,
            rows.Count, rows.Select(r => r.CustomerId).Distinct().Count(), presenceOnly, discoveredRows,
            newCodes.Count, toMint.Count, options.DryRun, unknownCodes,
            manualMaster.Count, manualOutOfScope, unverifiable.Count, Describe(outOfScope));

        return new CustomerSyncSourceResult
        {
            Source = Name,
            Rows = rows,
            ManualMaster = manualMaster,
            ManualMasterComplete = true,
            ManualUnverifiable = unverifiable,
            CustomersMinted = toMint.Count,
            Lookup = lookupInfo,
            Discovery = DiscoveryInfo(window, discovery, newCodes.Count, unknownCodes)
        };
    }

    /// <summary>
    /// Reads the discovery window: from <c>DiscoveryFrom</c> when given, else <see cref="DiscoveryWindowDaysKey"/> days
    /// back from today; always to tomorrow, so all of today is covered whatever the gateway's clock (the reader accepts
    /// the extra day on top of the 3660-day ceiling). A failed or partial read is logged and whatever links it returned
    /// (possibly none) are used.
    /// </summary>
    private async Task<(CtrmLinkDiscovery Links, DiscoveryWindow Window)> DiscoverAsync(CustomerSyncLoadOptions options, CancellationToken cancellationToken)
    {
        var today = _today().Date;
        var windowDays = Math.Clamp(CtrmConfig.ReadInt(_configuration, DiscoveryWindowDaysKey, 7), 1, 3660);
        if (windowDays > WarnWindowDays)
        {
            _logger.LogWarning(
                "CustomerSync CTRM feeder: {Key} is {Days} days, so every run reads more than a year of unfiltered contracts and tickets. For a one-off catch-up pass discoveryFrom to POST run instead.",
                DiscoveryWindowDaysKey, windowDays);
        }

        var from = options.DiscoveryFrom?.Date ?? today.AddDays(-windowDays);
        var to = today.AddDays(1);

        var read = await _activity.DiscoverAsync(from, to, cancellationToken);
        var links = read.Value ?? new CtrmLinkDiscovery();
        if (read.Status != CtrmReadStatus.Ok)
        {
            _logger.LogWarning(
                "CustomerSync CTRM feeder [{ErrorCode}] [{ErrorCategory}]: link discovery {From:yyyy-MM-dd}..{To:yyyy-MM-dd} answered {Status}; carrying on with the {Links} link(s) it returned (discovery only adds links). {Detail}",
                DiscoveryFailedCode, "Integration", from, to, read.Status, links.ContractLinks.Count + links.TicketLinks.Count, read.Detail);
        }

        // A read that failed as a whole has no per-source breakdown: both statuses carry the combined one.
        var window = new DiscoveryWindow(
            from, to,
            (read.Value?.ContractsStatus ?? read.Status).ToString(),
            (read.Value?.TicketsStatus ?? read.Status).ToString());
        return (links, window);
    }

    private sealed record DiscoveryWindow(DateTime From, DateTime To, string ContractsStatus, string TicketsStatus);

    private static CustomerSyncDiscoveryInfo DiscoveryInfo(DiscoveryWindow window, CtrmLinkDiscovery links, int newCodes, int unknownCodes) => new()
    {
        From = window.From,
        To = window.To,
        ContractsStatus = window.ContractsStatus,
        TicketsStatus = window.TicketsStatus,
        ContractRows = links.ContractRows,
        ContractPages = links.ContractPages,
        ContractsTruncated = links.ContractsTruncated,
        TicketRows = links.TicketRows,
        TicketPages = links.TicketPages,
        TicketsTruncated = links.TicketsTruncated,
        ContractLinks = links.ContractLinks.Count,
        TicketLinks = links.TicketLinks.Count,
        NewCodes = newCodes,
        UnknownCodes = unknownCodes
    };

    /// <summary>
    /// Ids for <paramref name="count"/> new producers, in order: reserved from <c>dbo.CustomerIdSequence</c> in one
    /// round trip, or <c>-1, -2, ...</c> on a dry run, which never touches the sequence.
    /// </summary>
    private async Task<IReadOnlyList<long>> IdsForNewProducersAsync(int count, bool dryRun, CancellationToken cancellationToken)
    {
        if (count == 0) return [];
        if (dryRun) return [.. Enumerable.Range(1, count).Select(i => -(long)i)];

        var ids = await _repository.ReserveCustomerIdsAsync(count, cancellationToken);
        if (ids.Count != count)
            throw new InvalidOperationException($"Reserved {ids.Count} customer id(s) for {count} new producer(s).");
        return ids;
    }

    /// <summary>
    /// A failed lookup: no rows, a <c>CUSTOMER_SYNC_*</c> code, and the lookup report. Order matters: a filter
    /// mismatch first; then a missing permission; then an HC0045 server timeout (a slow gateway, even though it
    /// arrives as a QueryError with HTTP 400); then a genuine HTTP 400 QueryError (a projection field or argument the
    /// API does not have); anything else is the source being unavailable.
    /// </summary>
    private CustomerSyncSourceResult LookupFailed(CtrmReadResult<CtrmCustomerLookup> lookup, int requested, CustomerSyncDiscoveryInfo discovery)
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
            },
            Discovery = discovery
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
