// System namespaces
using System.Text.Json;
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Sync;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The CTRM feeder builds the same view-shaped rows as the ODS feeder from GraphQL: the customer master
/// by <c>sourceCode</c> for every producer the app holds, the app's own sync links re-asserted, and new
/// links discovered from recent contracts and tickets. The property that matters most is that any lookup
/// failure fails CLOSED (no rows at all): a missing row deactivates a customer.
/// </summary>
/// <remarks>The readers are real; only the GraphQL client underneath them is fake.</remarks>
[Collection("CtrmThrottle")]
public class CtrmCustomerSyncSourceTests
{
    private static readonly DateTime Today = new(2026, 10, 6);

    private readonly FakeCtrmClient _client = new();
    private readonly Mock<ICustomerSyncRepository> _repo = new(MockBehavior.Strict);
    private readonly Mock<ILogger<CtrmCustomerSyncSource>> _logger = new();
    private readonly Dictionary<string, string?> _settings = new()
    {
        ["Ctrm:BackgroundMaxDeferSeconds"] = "0",
        ["Ctrm:ServerTimeoutRetries"] = "0",
        ["Ctrm:ServerTimeoutRetryDelaySeconds"] = "0"
    };

    public CtrmCustomerSyncSourceTests()
    {
        CtrmTradeUnitThrottle.ResetForTests();
    }

    /// <summary>
    /// Answers all three document kinds: the aliased customers lookup (by parsing the alias filters out of
    /// the document), and the two link-discovery documents (one page each, from preset lists).
    /// </summary>
    private sealed class FakeCtrmClient : ICtrmGraphQlClient
    {
        private static readonly Regex Alias = new(@"c(\d+): customers\(skip: 0, take: 5, sourceCode: (""[^""]*"")", RegexOptions.Compiled);

        public bool IsConfigured => true;

        /// <summary>Master rows per code; a code absent here comes back with no rows (missing).</summary>
        public Dictionary<string, List<CtrmCustomerDto>> Master { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>When set, every customers request answers this instead.</summary>
        public CtrmReadResult<Dictionary<string, CtrmPage<CtrmCustomerDto>>>? LookupFailure { get; set; }

        public List<CtrmContractLinkDto> ContractLinks { get; } = [];
        public List<CtrmTicketLinkDto> TicketLinks { get; } = [];
        public CtrmReadStatus? ContractsFailure { get; set; }
        public CtrmReadStatus? TicketsFailure { get; set; }

        /// <summary>Every code the customers lookup was asked for, across requests.</summary>
        public List<string> RequestedCodes { get; } = [];

        /// <summary>The (from, to) variables of every discovery request.</summary>
        public List<(string Document, string From, string To)> DiscoveryCalls { get; } = [];

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Assert.DoesNotContain('#', document);

            if (document == CtrmCustomerQueries.ContractLinksInWindow || document == CtrmCustomerQueries.TicketLinksInWindow)
            {
                var map = variables!.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(variables));
                lock (DiscoveryCalls) DiscoveryCalls.Add((document, Convert.ToString(map["from"])!, Convert.ToString(map["to"])!));

                object answer = document == CtrmCustomerQueries.ContractLinksInWindow
                    ? ContractsFailure is { } cf
                        ? new CtrmReadResult<CtrmContractLinksResponse> { Status = cf, Detail = "stub contracts failure" }
                        : new CtrmReadResult<CtrmContractLinksResponse>
                        {
                            Status = CtrmReadStatus.Ok,
                            Value = new() { Contracts = new() { TotalCount = ContractLinks.Count, PageInfo = new() { HasNextPage = false }, Items = ContractLinks } }
                        }
                    : TicketsFailure is { } tf
                        ? new CtrmReadResult<CtrmTicketLinksResponse> { Status = tf, Detail = "stub tickets failure" }
                        : new CtrmReadResult<CtrmTicketLinksResponse>
                        {
                            Status = CtrmReadStatus.Ok,
                            Value = new() { Tickets = new() { TotalCount = TicketLinks.Count, PageInfo = new() { HasNextPage = false }, Items = TicketLinks } }
                        };
                return Task.FromResult((CtrmReadResult<T>)answer);
            }

            var matches = Alias.Matches(document);
            Assert.NotEmpty(matches);
            var codes = matches.Select(m => JsonSerializer.Deserialize<string>(m.Groups[2].Value)!).ToList();
            lock (RequestedCodes) RequestedCodes.AddRange(codes);

            if (LookupFailure is { } failure)
                return Task.FromResult((CtrmReadResult<T>)(object)failure);

            var pages = new Dictionary<string, CtrmPage<CtrmCustomerDto>>();
            foreach (System.Text.RegularExpressions.Match m in matches)
            {
                var code = JsonSerializer.Deserialize<string>(m.Groups[2].Value)!;
                var items = Master.TryGetValue(code, out var rows) ? rows : [];
                pages[$"c{m.Groups[1].Value}"] = new CtrmPage<CtrmCustomerDto> { TotalCount = items.Count, Items = items };
            }
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)(object)pages });
        }
    }

    // -------------------------------------------------------------------------------------------------
    // Harness

    private CtrmCustomerSyncSource Sut()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(_settings).Build();
        return new CtrmCustomerSyncSource(
            new CtrmCustomerReader(_client, config, NullLogger<CtrmCustomerReader>.Instance),
            new CtrmCustomerActivityReader(_client, config, NullLogger<CtrmCustomerActivityReader>.Instance),
            _repo.Object, config, _logger.Object, () => Today);
    }

    private Task<CustomerSyncSourceResult> LoadAsync(CustomerSyncAppState appState, CustomerSyncLoadOptions? options = null) =>
        Sut().LoadAsync(appState, options ?? CustomerSyncLoadOptions.Default, CancellationToken.None);

    /// <summary>An in-scope master row for <paramref name="code"/>: active producer with a clean name.</summary>
    private void InMaster(string code, string activeYN = "Y", string? sourceCode = null) =>
        _client.Master[code] =
        [
            new CtrmCustomerDto
            {
                Id = JsonSerializer.SerializeToElement(Guid.NewGuid().ToString()),
                SourceCode = sourceCode ?? code,
                Name = code + " Farms",
                ActiveYN = activeYN,
                IndustryCode1 = "PR",
                MdmMasterRecord = JsonSerializer.SerializeToElement(true)
            }
        ];

    private static Customer Cust(long id, string? scoularId, bool isActive = true, bool isManual = false) =>
        new() { Id = id, ScoularId = scoularId, Name = "Old", IsActive = isActive, IsManual = isManual };

    private static CustomerTradeUnit Link(long customerId, string tradeUnit, bool isActive = true, bool isManual = false, bool userDeactivated = false) =>
        new() { CustomerId = customerId, TradeUnit = tradeUnit, IsActive = isActive, IsManual = isManual, UserDeactivated = userDeactivated };

    private static CustomerSyncAppState App(IEnumerable<Customer> customers, IEnumerable<CustomerTradeUnit>? links = null) =>
        new() { Customers = customers.ToList(), TradeUnits = (links ?? []).ToList() };

    private static HashSet<(long, string?)> RowKeys(CustomerSyncSourceResult result) =>
        result.Rows.Select(r => (r.CustomerId, r.TradeUnit)).ToHashSet();

    private static Customer Applied(CustomerSyncAttributes attributes)
    {
        var target = new Customer();
        attributes.ApplyTo(target);
        return target;
    }

    // -------------------------------------------------------------------------------------------------
    // C4a — master lookup → rows from existing links

    [Fact]
    public async Task LoadAsync_LooksUpEveryScoularIdInTheAppTable_ActiveOrNot_ManualOrNot()
    {
        var app = App([Cust(1, "AAA"), Cust(2, "BBB", isActive: false), Cust(3, " CCC ", isManual: true), Cust(4, null)]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Equal(new[] { "AAA", "BBB", "CCC" }, _client.RequestedCodes.OrderBy(c => c, StringComparer.Ordinal));
        Assert.Equal(3, result.Lookup!.Requested);
        Assert.Equal("granted", result.Lookup.Permission);
        Assert.Equal(nameof(CtrmReadStatus.Ok), result.Lookup.Status);
    }

    [Fact]
    public async Task LoadAsync_InScopeCustomer_ReassertsItsActiveSyncLinks_AndSkipsManualAndInactiveOnes()
    {
        InMaster("SMITFAR");
        var app = App(
            [Cust(1, "SMITFAR")],
            [Link(1, "1085"), Link(1, "2200", isManual: true), Link(1, "3300", isActive: false), Link(1, "4400", isActive: false, userDeactivated: true)]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Equal(new HashSet<(long, string?)> { (1, "1085") }, RowKeys(result));
        var row = Assert.Single(result.Rows);
        Assert.IsType<CtrmCustomerSyncAttributes>(row.Attributes);
        Assert.Equal("SMITFAR Farms", Applied(row.Attributes).Name);
        Assert.Equal(CustomerSyncSources.Ctrm, result.Source);
        Assert.Null(result.Discovery);
    }

    [Fact]
    public async Task LoadAsync_ReassertedLink_IsTrimmed()
    {
        InMaster("SMITFAR");
        var app = App([Cust(1, "SMITFAR")], [Link(1, " 1085 ")]);

        var result = await LoadAsync(app);

        Assert.Equal(new HashSet<(long, string?)> { (1, "1085") }, RowKeys(result));
    }

    [Fact]
    public async Task LoadAsync_CustomerWithOnlyUserDeactivatedLinks_GetsAPresenceRowWithNullTradeUnit()
    {
        InMaster("SMITFAR");
        var app = App([Cust(1, "SMITFAR")], [Link(1, "4400", isActive: false, userDeactivated: true)]);

        var result = await LoadAsync(app);

        var row = Assert.Single(result.Rows);
        Assert.Equal(1, row.CustomerId);
        Assert.Null(row.TradeUnit);
    }

    [Fact]
    public async Task LoadAsync_CustomerFailingTheFilters_GetsNoRows()
    {
        InMaster("SMITFAR", activeYN: "N");
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Empty(result.Rows);
    }

    [Fact]
    public async Task LoadAsync_CustomerMissingFromTheMaster_GetsNoRows()
    {
        var app = App([Cust(1, "GONE1")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Empty(result.Rows);
        Assert.Equal(1, result.Lookup!.Missing);
    }

    [Fact]
    public async Task LoadAsync_TwoAppRowsSharingAScoularId_EachGetTheirOwnRows()
    {
        InMaster("SMITFAR");
        var app = App([Cust(10, "SMITFAR"), Cust(11, "smitfar ")], [Link(10, "1085"), Link(11, "2200")]);

        var result = await LoadAsync(app);

        Assert.Equal(new HashSet<(long, string?)> { (10, "1085"), (11, "2200") }, RowKeys(result));
        Assert.Equal(1, result.Lookup!.Requested);
    }

    [Fact]
    public async Task LoadAsync_ManualCustomerInScopeWithoutEvidence_LandsInManualMaster()
    {
        InMaster("MANUAL1");
        var app = App([Cust(900, "MANUAL1", isManual: true)], [Link(900, "1085", isManual: true)]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Empty(result.Rows);
        Assert.True(result.ManualMasterComplete);
        Assert.Equal("MANUAL1 Farms", Applied(result.ManualMaster[900]).Name);
    }

    [Fact]
    public async Task LoadAsync_ManualCustomerMissingFromTheMaster_IsAbsentFromManualMaster_AndABlankCodeIsUnverifiable()
    {
        var app = App([Cust(900, "GONE1", isManual: true), Cust(901, "  ", isManual: true), Cust(902, null, isManual: true)]);

        var result = await LoadAsync(app);

        Assert.True(result.Ok);
        Assert.Empty(result.ManualMaster);
        Assert.True(result.ManualMasterComplete);
        Assert.Equal(new HashSet<long> { 901, 902 }, result.ManualUnverifiable);
    }

    [Fact]
    public async Task LoadAsync_LookupUnauthorized_ReturnsFailedNoPermission_WithLookupInfo()
    {
        InMaster("SMITFAR");
        _client.LookupFailure = new() { Status = CtrmReadStatus.Unauthorized, HttpStatus = 403, Detail = "stub 403" };
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.False(result.Ok);
        Assert.Equal("CUSTOMER_SYNC_NO_PERMISSION", result.FailureCode);
        Assert.Contains("Customers.Read.All", result.FailureDetail);
        Assert.Empty(result.Rows);
        Assert.Equal("missing", result.Lookup!.Permission);
        Assert.Equal(nameof(CtrmReadStatus.Unauthorized), result.Lookup.Status);
        Assert.Equal(403, result.Lookup.HttpStatus);
        Assert.Equal(1, result.Lookup.Requested);
    }

    [Fact]
    public async Task LoadAsync_LookupHttp400_ReturnsFailedSchemaMismatch()
    {
        InMaster("SMITFAR");
        _client.LookupFailure = new() { Status = CtrmReadStatus.QueryError, HttpStatus = 400, Detail = "stub 400" };
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.False(result.Ok);
        Assert.Equal("CUSTOMER_SYNC_SCHEMA_MISMATCH", result.FailureCode);
        Assert.Empty(result.Rows);
        Assert.Equal("unknown", result.Lookup!.Permission);
    }

    [Fact]
    public async Task LoadAsync_LookupServerTimeout_ReturnsFailedSourceUnavailable_NotSchemaMismatch()
    {
        InMaster("SMITFAR");
        _client.LookupFailure = new() { Status = CtrmReadStatus.QueryError, HttpStatus = 400, ErrorCode = CtrmServerTimeoutRetry.ServerTimeoutCode, Detail = "stub timeout" };
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.False(result.Ok);
        Assert.Equal("CUSTOMER_SYNC_SOURCE_UNAVAILABLE", result.FailureCode);
        Assert.Empty(result.Rows);
    }

    [Fact]
    public async Task LoadAsync_LookupEgressBlocked_ReturnsFailedSourceUnavailable()
    {
        InMaster("SMITFAR");
        _client.LookupFailure = new() { Status = CtrmReadStatus.EgressBlocked, Detail = "stub egress" };
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.False(result.Ok);
        Assert.Equal("CUSTOMER_SYNC_SOURCE_UNAVAILABLE", result.FailureCode);
        Assert.Empty(result.Rows);
        Assert.Equal(nameof(CtrmReadStatus.EgressBlocked), result.Lookup!.Status);
    }

    [Fact]
    public async Task LoadAsync_LookupFilterMismatch_ReturnsFailedFilterMismatch()
    {
        // The API answered the alias for SMITFAR with another producer's row.
        InMaster("SMITFAR", sourceCode: "JONES2");
        var app = App([Cust(1, "SMITFAR")], [Link(1, "1085")]);

        var result = await LoadAsync(app);

        Assert.False(result.Ok);
        Assert.Equal(CtrmCustomerReader.FilterMismatchCode, result.FailureCode);
        Assert.Equal("CUSTOMER_SYNC_FILTER_MISMATCH", result.FailureCode);
        Assert.Empty(result.Rows);
        Assert.Equal("unknown", result.Lookup!.Permission);
    }

    [Fact]
    public void Factory_Ctrm_ReturnsTheCtrmSource_NotTheOdsSource()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(_settings).Build());
        services.AddSingleton<ICtrmGraphQlClient>(_client);
        services.AddSingleton<CtrmCustomerReader>();
        services.AddSingleton<CtrmCustomerActivityReader>();
        services.AddScoped(_ => _repo.Object);
        services.AddScoped<OdsCustomerSyncSource>();
        services.AddScoped<CtrmCustomerSyncSource>();
        services.AddScoped<ICustomerSyncSourceFactory, CustomerSyncSourceFactory>();
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        using var scope = provider.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<ICustomerSyncSourceFactory>();

        var ctrm = factory.Create(CustomerSyncSources.Ctrm);

        Assert.IsType<CtrmCustomerSyncSource>(ctrm);
        Assert.IsNotType<OdsCustomerSyncSource>(ctrm);
        Assert.Equal(CustomerSyncSources.Ctrm, ctrm.Name);
        Assert.IsType<OdsCustomerSyncSource>(factory.Create(CustomerSyncSources.Ods));
    }
}
