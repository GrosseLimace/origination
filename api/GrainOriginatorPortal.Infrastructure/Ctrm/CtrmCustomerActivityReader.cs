using System.Globalization;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>A customer-to-trade-unit link found in CTRM activity. <see cref="Code"/> is trimmed and
/// upper-cased; <see cref="TradeUnit"/> is trimmed.</summary>
public readonly record struct CtrmCustomerLink(string Code, string TradeUnit);

/// <summary>What one discovery run found, per source, with enough counters to tell a quiet week from a
/// truncated or failed read.</summary>
public sealed class CtrmLinkDiscovery
{
    public HashSet<CtrmCustomerLink> ContractLinks { get; } = [];
    public HashSet<CtrmCustomerLink> TicketLinks { get; } = [];
    public CtrmReadStatus ContractsStatus { get; set; }
    public CtrmReadStatus TicketsStatus { get; set; }
    public int ContractRows { get; set; }
    public int ContractPages { get; set; }
    public bool ContractsTruncated { get; set; }
    public int TicketRows { get; set; }
    public int TicketPages { get; set; }
    public bool TicketsTruncated { get; set; }
    public IEnumerable<CtrmCustomerLink> All => ContractLinks.Concat(TicketLinks);
}

/// <summary>
/// Discovers customer-to-trade-unit links (and producers the app has never seen) from every contract
/// and ticket in a recent date window.
/// </summary>
/// <remarks>
/// <para>The ODS view derives a customer's trade units from its contracts (<c>TradeUnit</c>) and its
/// tickets (<c>OrganizationCode</c>) over all time, and those rows are never removed, so a link once
/// earned is permanent. The nightly CTRM sync therefore re-asserts the links it already holds and only
/// needs this reader to find NEW ones, from two unfiltered reads over a short, overlapping window.</para>
///
/// <para>Discovery is additive: a partial read still returns the links it collected, marked
/// <see cref="CtrmReadStatus.PartialSuccess"/>, and never implies a removal.</para>
/// </remarks>
public sealed class CtrmCustomerActivityReader
{
    public const string MaxPagesKey = "CustomerSync:DiscoveryMaxPagesPerWindow";
    public const int PageSize = 500;

    private readonly ICtrmGraphQlClient _client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CtrmCustomerActivityReader> _logger;

    public CtrmCustomerActivityReader(ICtrmGraphQlClient client, IConfiguration configuration, ILogger<CtrmCustomerActivityReader> logger)
    {
        _client = client;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Reads every contract in <paramref name="from"/>..<paramref name="to"/> (inclusive) and returns the
    /// customer-to-trade-unit links found.
    /// </summary>
    /// <remarks>
    /// The span is sliced into windows of at most <see cref="CtrmQueries.MaxTicketRangeDays"/> and each
    /// window is paged sequentially, capped at <see cref="MaxPagesKey"/> pages, through the shared
    /// background throttle and the server-timeout retry - this is a nightly walk on the shared gateway.
    /// A failed page stops that source for the rest of the run but keeps the links already collected.
    /// </remarks>
    public async Task<CtrmReadResult<CtrmLinkDiscovery>> DiscoverAsync(DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        var maxPages = Math.Max(1, CtrmConfig.ReadInt(_configuration, MaxPagesKey, 200));
        var discovery = new CtrmLinkDiscovery();
        var contracts = new SourceRead("contracts");

        foreach (var window in Slice(from, to, CtrmQueries.MaxTicketRangeDays))
        {
            if (!contracts.Failed)
                await ReadWindowAsync(contracts, CtrmCustomerQueries.ContractLinksInWindow, window, maxPages,
                    (CtrmContractLinksResponse? response) => response?.Contracts,
                    row => AddLink(discovery.ContractLinks, row.CustomerId, row.TradeUnit),
                    cancellationToken);
        }

        discovery.ContractsStatus = contracts.Status;
        discovery.ContractRows = contracts.Rows;
        discovery.ContractPages = contracts.Pages;
        discovery.ContractsTruncated = contracts.Truncated;

        var complete = contracts.Status == CtrmReadStatus.Ok && !contracts.Truncated;
        return new CtrmReadResult<CtrmLinkDiscovery>
        {
            Status = complete ? CtrmReadStatus.Ok : CtrmReadStatus.PartialSuccess,
            Detail = complete ? null : contracts.Describe(),
            Value = discovery
        };
    }

    /// <summary>
    /// Splits <paramref name="from"/>..<paramref name="to"/> into consecutive inclusive windows of at most
    /// <paramref name="maxDays"/> days, oldest first.
    /// </summary>
    /// <remarks>
    /// Each window starts the day after the previous one ends, so a row dated on a boundary is read once.
    /// </remarks>
    public static List<(DateTime From, DateTime To)> Slice(DateTime from, DateTime to, int maxDays)
    {
        var width = Math.Max(1, maxDays);
        var end = to.Date;
        var windows = new List<(DateTime From, DateTime To)>();

        for (var start = from.Date; start <= end; start = start.AddDays(width))
        {
            var windowEnd = start.AddDays(width - 1);
            windows.Add((start, windowEnd < end ? windowEnd : end));
        }

        return windows;
    }

    /// <summary>
    /// Pages one source through one window, handing every row to <paramref name="collect"/> and adding
    /// the counters to <paramref name="source"/>.
    /// </summary>
    /// <remarks>
    /// Stops when the server reports no next page or returns a short page; stops at
    /// <paramref name="maxPages"/> with <see cref="SourceRead.Truncated"/> set when it still reports more.
    /// </remarks>
    private async Task ReadWindowAsync<TResponse, TRow>(
        SourceRead source,
        string document,
        (DateTime From, DateTime To) window,
        int maxPages,
        Func<TResponse?, CtrmPage<TRow>?> pageOf,
        Action<TRow> collect,
        CancellationToken cancellationToken)
    {
        var label = $"{window.From:yyyy-MM-dd}..{window.To:yyyy-MM-dd}";
        var windowFrom = window.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var windowTo = window.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var pages = 0;
        var more = true;

        while (more && pages < maxPages)
        {
            var skip = pages * PageSize;
            var result = await CtrmTradeUnitThrottle.RunAsync(_configuration, () => CtrmServerTimeoutRetry.RunAsync(
                () => _client.QueryAsync<TResponse>(
                    document,
                    new { from = windowFrom, to = windowTo, skip, take = PageSize },
                    cancellationToken),
                _configuration, _logger, $"{source.Name} link discovery page skip={skip} {label}"));

            var page = result.Ok ? pageOf(result.Value) : null;
            if (page is null)
            {
                source.Fail(result.Ok
                    ? new CtrmReadResult<TResponse> { Status = CtrmReadStatus.Error, HttpStatus = result.HttpStatus, Detail = $"CTRM returned no {source.Name} object." }
                    : result, label);
                return;
            }

            if (result.Status == CtrmReadStatus.PartialSuccess) source.Partial = true;
            pages++;
            source.Pages++;
            source.Rows += page.Items.Count;
            foreach (var row in page.Items) collect(row);

            more = page.PageInfo?.HasNextPage == true && page.Items.Count >= PageSize;
        }

        if (!more) return;

        source.Truncated = true;
        _logger.LogWarning(
            "CTRM link discovery TRUNCATED [{ErrorCode}] [{ErrorCategory}]: {Source} window {Window} still had more " +
            "after {MaxPages} pages ({Rows} rows read so far); links beyond the cap are not discovered this run.",
            "INFRASTRUCTURE_CTRM_TRUNCATED", "Infrastructure", source.Name, label, maxPages, source.Rows);
    }

    /// <summary>Adds a link when both halves are present: the code trimmed and upper-cased, the trade unit
    /// trimmed. A blank or null half is dropped - it cannot be a membership.</summary>
    private static void AddLink(HashSet<CtrmCustomerLink> links, string? code, string? tradeUnit)
    {
        var trimmedCode = code?.Trim();
        var trimmedTradeUnit = tradeUnit?.Trim();
        if (string.IsNullOrEmpty(trimmedCode) || string.IsNullOrEmpty(trimmedTradeUnit)) return;

        links.Add(new CtrmCustomerLink(trimmedCode.ToUpperInvariant(), trimmedTradeUnit));
    }

    /// <summary>Running state of one source (contracts or tickets) across the windows of a run.</summary>
    private sealed class SourceRead(string name)
    {
        public string Name { get; } = name;
        public int Pages { get; set; }
        public int Rows { get; set; }
        public bool Truncated { get; set; }
        public bool Partial { get; set; }

        public CtrmReadStatus? FailureStatus { get; private set; }
        public int? FailureHttpStatus { get; private set; }
        public string? FailureErrorCode { get; private set; }
        public string? FailureDetail { get; private set; }

        public bool Failed => FailureStatus is not null;

        /// <summary>The failure status; else PartialSuccess when any page came back data-plus-errors; else
        /// Ok. Truncation is reported separately.</summary>
        public CtrmReadStatus Status => FailureStatus ?? (Partial ? CtrmReadStatus.PartialSuccess : CtrmReadStatus.Ok);

        public void Fail<T>(CtrmReadResult<T> failure, string window)
        {
            FailureStatus = failure.Status;
            FailureHttpStatus = failure.HttpStatus;
            FailureErrorCode = failure.ErrorCode;
            FailureDetail = $"{Name} link discovery failed in {window}: {failure.Detail}";
        }

        /// <summary>One operator-facing sentence, or null when this source is complete.</summary>
        public string? Describe() =>
            FailureDetail
            ?? (Truncated ? $"{Name} link discovery truncated at the page cap." : null)
            ?? (Partial ? $"{Name} link discovery returned partial data on some pages." : null);
    }
}
