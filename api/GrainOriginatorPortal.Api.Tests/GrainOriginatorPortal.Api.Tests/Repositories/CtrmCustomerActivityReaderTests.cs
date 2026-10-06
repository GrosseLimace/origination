// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Link discovery for the customer sync: every contract and ticket in a recent date window, read
/// unfiltered, yields the customer-to-trade-unit links (and new producers) the nightly run adds.
/// </summary>
/// <remarks>
/// Discovery is additive only, so what matters is that a partial read still hands back what it
/// collected, that every request stays inside the ticket query's 366-day limit, and that the page cap
/// protects the shared gateway.
/// </remarks>
[Collection("CtrmThrottle")]
public class CtrmCustomerActivityReaderTests
{
    private static readonly DateTime WeekFrom = new(2026, 9, 29);
    private static readonly DateTime WeekTo = new(2026, 10, 7);

    /// <summary>One request as the fake client saw it.</summary>
    private sealed record Call(string Document, string From, string To, int Skip, int Take);

    /// <summary>
    /// Answers the two discovery documents through per-document handlers and records every request.
    /// Both handlers default to an empty last page.
    /// </summary>
    private sealed class LinksClient : ICtrmGraphQlClient
    {
        public bool IsConfigured => true;
        public List<Call> Calls { get; } = [];
        public List<Call> ContractCalls => [.. Calls.Where(c => c.Document == CtrmCustomerQueries.ContractLinksInWindow)];
        public List<Call> TicketCalls => [.. Calls.Where(c => c.Document == CtrmCustomerQueries.TicketLinksInWindow)];

        public Func<Call, CtrmReadResult<CtrmContractLinksResponse>> Contracts { get; init; } =
            _ => ContractPage([], hasNextPage: false);

        public Func<Call, CtrmReadResult<CtrmTicketLinksResponse>> Tickets { get; init; } =
            _ => TicketPage([], hasNextPage: false);

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Assert.DoesNotContain('#', document);

            var map = variables as IReadOnlyDictionary<string, object?>
                ?? variables?.GetType().GetProperties().ToDictionary(x => x.Name, x => x.GetValue(variables))
                ?? new Dictionary<string, object?>();
            var call = new Call(
                document,
                Convert.ToString(map["from"])!,
                Convert.ToString(map["to"])!,
                Convert.ToInt32(map["skip"]),
                Convert.ToInt32(map["take"]));
            lock (Calls) Calls.Add(call);

            object result = document switch
            {
                CtrmCustomerQueries.ContractLinksInWindow => Contracts(call),
                CtrmCustomerQueries.TicketLinksInWindow => Tickets(call),
                _ => throw new InvalidOperationException("Unexpected document: " + document)
            };
            return Task.FromResult((CtrmReadResult<T>)result);
        }
    }

    private static CtrmReadResult<CtrmContractLinksResponse> ContractPage(IEnumerable<CtrmContractLinkDto> items, bool hasNextPage)
    {
        var list = items.ToList();
        return new()
        {
            Status = CtrmReadStatus.Ok,
            HttpStatus = 200,
            Value = new CtrmContractLinksResponse
            {
                Contracts = new CtrmPage<CtrmContractLinkDto>
                {
                    TotalCount = list.Count,
                    PageInfo = new CtrmPageInfo { HasNextPage = hasNextPage },
                    Items = list
                }
            }
        };
    }

    private static CtrmReadResult<CtrmTicketLinksResponse> TicketPage(IEnumerable<CtrmTicketLinkDto> items, bool hasNextPage)
    {
        var list = items.ToList();
        return new()
        {
            Status = CtrmReadStatus.Ok,
            HttpStatus = 200,
            Value = new CtrmTicketLinksResponse
            {
                Tickets = new CtrmPage<CtrmTicketLinkDto>
                {
                    TotalCount = list.Count,
                    PageInfo = new CtrmPageInfo { HasNextPage = hasNextPage },
                    Items = list
                }
            }
        };
    }

    private static IEnumerable<CtrmContractLinkDto> ContractRows(int count, string? customerId, string? tradeUnit) =>
        Enumerable.Range(0, count).Select(_ => new CtrmContractLinkDto { CustomerId = customerId, TradeUnit = tradeUnit });

    private static IConfiguration Config(int? maxPagesPerWindow = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
            ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0",
            [CtrmCustomerActivityReader.MaxPagesKey] = maxPagesPerWindow?.ToString()
        }).Build();

    private static CtrmCustomerActivityReader Sut(ICtrmGraphQlClient client, IConfiguration? config = null) =>
        new(client, config ?? Config(), new Mock<ILogger<CtrmCustomerActivityReader>>().Object);

    public CtrmCustomerActivityReaderTests() => CtrmTradeUnitThrottle.ResetForTests();

    // -------------------------------------------------------------------------
    [Fact]
    public void Slice_SevenDays_IsOneWindow()
    {
        var windows = CtrmCustomerActivityReader.Slice(new DateTime(2026, 9, 29), new DateTime(2026, 10, 7), CtrmQueries.MaxTicketRangeDays);

        Assert.Equal([(new DateTime(2026, 9, 29), new DateTime(2026, 10, 7))], windows);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void Slice_EightHundredDays_IsThreeWindowsOfAtMost366_Contiguous()
    {
        var from = new DateTime(2024, 7, 29);
        var to = from.AddDays(800);

        var windows = CtrmCustomerActivityReader.Slice(from, to, CtrmQueries.MaxTicketRangeDays);

        Assert.Equal(3, windows.Count);
        Assert.Equal(from, windows[0].From);
        Assert.Equal(to, windows[^1].To);
        Assert.All(windows, w => Assert.True((w.To - w.From).TotalDays + 1 <= 366, $"{w.From:yyyy-MM-dd}..{w.To:yyyy-MM-dd} is wider than 366 days"));
        for (var i = 1; i < windows.Count; i++)
            Assert.Equal(windows[i - 1].To.AddDays(1), windows[i].From);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_PagesContractsUntilHasNextPageIsFalse_AndCollectsTrimmedUpperLinks()
    {
        // 500 + 20 rows: padded lower-case codes, plus one blank trade unit and one null customer that must be dropped.
        var client = new LinksClient
        {
            Contracts = call => call.Skip == 0
                ? ContractPage(
                    ContractRows(1, " tatobin ", "   ")
                        .Concat(ContractRows(1, null, "1085"))
                        .Concat(ContractRows(498, " tatobin ", "1085 ")),
                    hasNextPage: true)
                : ContractPage(ContractRows(20, " tatobin ", "1085 "), hasNextPage: false)
        };

        var result = await Sut(client).DiscoverAsync(WeekFrom, WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        var discovery = Assert.IsType<CtrmLinkDiscovery>(result.Value);
        Assert.Equal([new CtrmCustomerLink("TATOBIN", "1085")], discovery.ContractLinks);
        Assert.Equal(2, discovery.ContractPages);
        Assert.Equal(520, discovery.ContractRows);
        Assert.Equal(CtrmReadStatus.Ok, discovery.ContractsStatus);
        Assert.False(discovery.ContractsTruncated);
        Assert.Equal([0, 500], client.ContractCalls.Select(c => c.Skip));
        Assert.All(client.ContractCalls, c =>
        {
            Assert.Equal("2026-09-29", c.From);
            Assert.Equal("2026-10-07", c.To);
            Assert.Equal(CtrmCustomerActivityReader.PageSize, c.Take);
        });
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_PageCapHit_MarksContractsTruncated_AndStillReturnsCollectedLinks()
    {
        // The server always claims more; the cap must stop the walk without discarding what it read.
        var client = new LinksClient
        {
            Contracts = _ => ContractPage(ContractRows(CtrmCustomerActivityReader.PageSize, "SMITH1", "2200"), hasNextPage: true)
        };

        var result = await Sut(client, Config(maxPagesPerWindow: 1)).DiscoverAsync(WeekFrom, WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.PartialSuccess, result.Status);
        var discovery = Assert.IsType<CtrmLinkDiscovery>(result.Value);
        Assert.True(discovery.ContractsTruncated);
        Assert.Equal(1, discovery.ContractPages);
        Assert.Single(client.ContractCalls);
        Assert.Equal([new CtrmCustomerLink("SMITH1", "2200")], discovery.ContractLinks);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_TicketDetails_LinkEveryDetailCustomer_ToItsOrganizationCode()
    {
        // A split load: every detail customer is linked, not only the first; a detail without an organization is dropped.
        var client = new LinksClient
        {
            Tickets = _ => TicketPage([Ticket(("SMITH1", "2200"), ("JONES2", "2200"), ("SMITH1", null))], hasNextPage: false)
        };

        var result = await Sut(client).DiscoverAsync(WeekFrom, WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        var discovery = Assert.IsType<CtrmLinkDiscovery>(result.Value);
        Assert.Equal(
            new HashSet<CtrmCustomerLink> { new("SMITH1", "2200"), new("JONES2", "2200") },
            discovery.TicketLinks);
        Assert.Equal(1, discovery.TicketRows);
        Assert.Equal(1, discovery.TicketPages);
        Assert.Equal(CtrmReadStatus.Ok, discovery.TicketsStatus);
        Assert.Equal(("2026-09-29", "2026-10-07"), (client.TicketCalls.Single().From, client.TicketCalls.Single().To));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_TicketsFail_ContractsOk_IsPartialSuccess_WithContractLinksKept()
    {
        var client = new LinksClient
        {
            Contracts = _ => ContractPage(ContractRows(1, "SMITH1", "2200"), hasNextPage: false),
            Tickets = _ => Failed<CtrmTicketLinksResponse>(CtrmReadStatus.EgressBlocked, httpStatus: null)
        };

        var result = await Sut(client).DiscoverAsync(WeekFrom, WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.PartialSuccess, result.Status);
        var discovery = Assert.IsType<CtrmLinkDiscovery>(result.Value);
        Assert.Equal(CtrmReadStatus.EgressBlocked, discovery.TicketsStatus);
        Assert.Equal(CtrmReadStatus.Ok, discovery.ContractsStatus);
        Assert.Equal([new CtrmCustomerLink("SMITH1", "2200")], discovery.ContractLinks);
        Assert.Empty(discovery.TicketLinks);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_BothFail_ReturnsTheContractFailureStatus_WithNullValue()
    {
        var client = new LinksClient
        {
            Contracts = _ => Failed<CtrmContractLinksResponse>(CtrmReadStatus.Throttled, httpStatus: 429),
            Tickets = _ => Failed<CtrmTicketLinksResponse>(CtrmReadStatus.EgressBlocked, httpStatus: null)
        };

        var result = await Sut(client).DiscoverAsync(WeekFrom, WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Throttled, result.Status);
        Assert.Equal(429, result.HttpStatus);
        Assert.Null(result.Value);
        Assert.False(result.Ok);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_WindowOver366Days_SlicesTicketsButSendsEachWindowSeparately()
    {
        // The tickets query rejects a range over 366 days, so a 400-day span must go as two requests.
        var client = new LinksClient();
        var from = new DateTime(2025, 9, 1);

        var result = await Sut(client).DiscoverAsync(from, from.AddDays(400), CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        var windows = client.TicketCalls.Select(c => (c.From, c.To)).Distinct().ToList();
        Assert.Equal(2, windows.Count);
        Assert.All(windows, w =>
            Assert.True((DateTime.Parse(w.To) - DateTime.Parse(w.From)).TotalDays + 1 <= 366, $"{w.From}..{w.To} is wider than 366 days"));
        Assert.Equal("2025-09-01", windows[0].From);
        Assert.Equal(from.AddDays(400).ToString("yyyy-MM-dd"), windows[^1].To);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_FromAfterTo_ReturnsOkWithNoLinks_AndNoRequest()
    {
        var client = new LinksClient();

        var result = await Sut(client).DiscoverAsync(WeekTo, WeekFrom, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Ok, result.Status);
        var discovery = Assert.IsType<CtrmLinkDiscovery>(result.Value);
        Assert.Empty(discovery.All);
        Assert.Empty(client.Calls);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task DiscoverAsync_SpanOverTenYears_IsRejectedAsError()
    {
        // An accidental "all time" span would be thousands of pages on the shared PROD gateway.
        var client = new LinksClient();

        var result = await Sut(client).DiscoverAsync(new DateTime(2016, 1, 1), WeekTo, CancellationToken.None);

        Assert.Equal(CtrmReadStatus.Error, result.Status);
        Assert.Equal("discovery window exceeds 3660 days — set discoveryFrom deliberately", result.Detail);
        Assert.Null(result.Value);
        Assert.Empty(client.Calls);
    }

    private static CtrmTicketLinkDto Ticket(params (string? CustomerCode, string? OrganizationCode)[] details) => new()
    {
        Details = [.. details.Select(d => new CtrmTicketLinkDetailDto { CustomerCode = d.CustomerCode, OrganizationCode = d.OrganizationCode })]
    };

    private static CtrmReadResult<T> Failed<T>(CtrmReadStatus status, int? httpStatus) => new()
    {
        Status = status,
        HttpStatus = httpStatus,
        Detail = $"simulated {status}"
    };
}
