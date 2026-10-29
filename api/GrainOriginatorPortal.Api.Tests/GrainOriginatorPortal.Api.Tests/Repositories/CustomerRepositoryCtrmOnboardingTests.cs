// System namespaces
using System.Text.Json;

// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Ctrm.Dtos;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Onboarding on the <c>ctrm</c> customer source (plan E3/E4): the search routes to the CTRM seam, a candidate
/// carries a negative placeholder id, onboarding goes by ScoularId and mints the real id, and a placeholder
/// without a code cannot be onboarded. The CTRM reader itself is covered by CtrmCustomerReaderSearchTests;
/// here the seams are overridden, as the ODS tests do - except the lane test at the end, which runs the real reader.
/// </summary>
/// <remarks>In the throttle collection because that lane test holds the process-wide CTRM pool.</remarks>
[Collection("CtrmThrottle")]
public class CustomerRepositoryCtrmOnboardingTests
{
    private const long MintedId = 5_000_000_000_000_777;

    public CustomerRepositoryCtrmOnboardingTests() => CtrmTradeUnitThrottle.ResetForTests();

    private sealed class TestableCustomerRepository : CustomerRepository
    {
        public TestableCustomerRepository(OriginationDbContext ods, ApplicationDbContext app, string source, ICustomerSyncRepository? sync)
            : base(ods, app,
                new Mock<ITicketRepository>(MockBehavior.Strict).Object,
                new Mock<IContractRepository>(MockBehavior.Strict).Object,
                new Mock<ILogger<CustomerRepository>>().Object,
                new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["CustomerSync:Source"] = source }).Build(),
                ctrmCustomers: null, syncRepository: sync)
        {
        }

        public List<Customer> CtrmCandidates { get; } = [];
        public Customer? ByCode { get; set; }
        public List<string> CodesAsked { get; } = [];
        public int IdLoads { get; private set; }

        // QueryOnboardingCandidatesAsync is NOT overridden: the real routing on CustomerSync:Source is what
        // the search test exercises, and on 'ctrm' it lands here.
        protected override Task<List<Customer>> QueryCtrmOnboardingCandidatesAsync(string searchTerm, CancellationToken ct) =>
            Task.FromResult(CtrmCandidates.ToList());

        protected override Task<Customer?> LoadOnboardingCandidateByCodeAsync(string scoularId, CancellationToken ct)
        {
            CodesAsked.Add(scoularId);
            return Task.FromResult(ByCode);
        }

        protected override Task<Customer?> LoadOnboardingCandidateAsync(long customerId, CancellationToken ct)
        {
            IdLoads++;
            return Task.FromResult<Customer?>(null);
        }
    }

    private static TestableCustomerRepository Build(out ApplicationDbContext app, string source = "ctrm", Mock<ICustomerSyncRepository>? sync = null)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"ctrm-onb-ods-{Guid.NewGuid()}").Options);
        app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"ctrm-onb-app-{Guid.NewGuid()}").Options);
        return new TestableCustomerRepository(ods, app, source, sync?.Object);
    }

    private static Mock<ICustomerSyncRepository> MintingRepository()
    {
        var sync = new Mock<ICustomerSyncRepository>(MockBehavior.Strict);
        sync.Setup(s => s.ReserveCustomerIdsAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync([MintedId]);
        return sync;
    }

    private static Customer CtrmCandidate(string code) =>
        new() { Id = CtrmCustomerCandidateId.From(code), ScoularId = code, Name = $"Candidate {code}", IsActive = true };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SearchOdsAsync_OnCtrmSource_ReturnsCtrmCandidates_WithPlaceholderIds_AndDedupesByScoularId()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = 777, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();
        sut.CtrmCandidates.AddRange([CtrmCandidate("SMITFAR"), CtrmCandidate("JONESFA")]);

        var result = await sut.SearchOdsAsync("farm", CancellationToken.None);

        var only = Assert.Single(result);
        Assert.Equal("JONESFA", only.ScoularId);
        Assert.True(CtrmCustomerCandidateId.IsCandidate(only.Id));
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_PlaceholderWithScoularId_LoadsByCode_MintsTheId_AndInserts()
    {
        var sync = MintingRepository();
        var sut = Build(out var app, sync: sync);
        var placeholder = CtrmCustomerCandidateId.From("JONESFA");
        sut.ByCode = CtrmCandidate("JONESFA");

        var outcome = await sut.AssignTradeUnitsAsync(placeholder, ["1085"], "jonesfa", "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(MintedId, outcome.CustomerId);
        Assert.False(outcome.Adopted);                                   // a new row, not an adoption
        Assert.Equal(["jonesfa"], sut.CodesAsked);
        Assert.Equal(0, sut.IdLoads);
        var inserted = Assert.Single(app.Customers);
        Assert.Equal(MintedId, inserted.Id);
        Assert.True(inserted.IsManual);
        Assert.True(inserted.IsActive);
        var tu = Assert.Single(app.CustomerTradeUnits);
        Assert.Equal(MintedId, tu.CustomerId);
        Assert.Equal("1085", tu.TradeUnit);
        sync.Verify(s => s.ReserveCustomerIdsAsync(1, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_PlaceholderWithScoularId_AdoptsAnExistingRow_WithoutMinting()
    {
        var sync = new Mock<ICustomerSyncRepository>(MockBehavior.Strict);                // minting would throw
        var sut = Build(out var app, sync: sync);
        app.Customers.Add(new Customer { Id = 4242, ScoularId = "JONESFA", Name = "Jones Farms", IsActive = true });
        app.SaveChanges();
        sut.ByCode = CtrmCandidate("JONESFA");

        var outcome = await sut.AssignTradeUnitsAsync(CtrmCustomerCandidateId.From("JONESFA"), ["1085"], "JONESFA", "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(4242, outcome.CustomerId);
        Assert.True(outcome.Adopted);
        Assert.Equal(1, app.Customers.Count());
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_PlaceholderWithoutScoularId_IsCustomerNotFound_WithoutLoadingAnything()
    {
        var sut = Build(out _, sync: MintingRepository());

        var outcome = await sut.AssignTradeUnitsAsync(CtrmCustomerCandidateId.From("JONESFA"), ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.CustomerNotFound, outcome.Result);
        Assert.Empty(sut.CodesAsked);
        Assert.Equal(0, sut.IdLoads);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_CtrmSource_UnknownPositiveIdWithoutACode_IsNeverLookedUpInTheOds()
    {
        var sut = Build(out var app, sync: MintingRepository());

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.CustomerNotFound, outcome.Result);
        Assert.Equal(0, sut.IdLoads);                                    // the ODS-by-id seam was not called
        Assert.Empty(sut.CodesAsked);
        Assert.Empty(app.Customers);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_OdsSource_UnknownPositiveIdWithoutACode_StillLoadsByOdsId()
    {
        var sut = Build(out _, source: "ods", sync: null);

        await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(1, sut.IdLoads);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_CodeUnknownToTheMaster_IsCustomerNotFound()
    {
        var sut = Build(out _, sync: MintingRepository());
        sut.ByCode = null;

        var outcome = await sut.AssignTradeUnitsAsync(CtrmCustomerCandidateId.From("NOPE001"), ["1085"], "NOPE001", "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.CustomerNotFound, outcome.Result);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_CtrmCandidate_WithNoMintingRepository_IsCustomerNotFound_AndInsertsNothing()
    {
        var sut = Build(out var app, sync: null);
        sut.ByCode = CtrmCandidate("JONESFA");

        var outcome = await sut.AssignTradeUnitsAsync(CtrmCustomerCandidateId.From("JONESFA"), ["1085"], "JONESFA", "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.CustomerNotFound, outcome.Result);
        Assert.Empty(app.Customers);
    }

    [Fact]
    public async Task AssignTradeUnitsAsync_OdsSource_WithScoularId_StillLoadsByCode_AndInsertsUnderTheOdsId()
    {
        var sut = Build(out var app, source: "ods", sync: null);
        sut.ByCode = new Customer { Id = 777, ScoularId = "JONESFA", Name = "Jones Farms", IsActive = true };

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], "JONESFA", "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(777, outcome.CustomerId);
        Assert.Equal(777, Assert.Single(app.Customers).Id);
        Assert.Equal(0, sut.IdLoads);
    }

    /// <summary>Answers a <c>customers(sourceCodes:)</c> page with one active, in-scope row per code asked for.</summary>
    private sealed class OneRowPerCodeClient : ICtrmGraphQlClient
    {
        private int _calls;
        public bool IsConfigured => true;
        public int Calls => Volatile.Read(ref _calls);

        public Task<CtrmReadResult<T>> QueryAsync<T>(string document, object? variables, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _calls);
            var codes = ((IEnumerable<string>)variables!.GetType().GetProperty("codes")!.GetValue(variables)!).ToList();
            var items = codes.Select(code => new CtrmCustomerDto
            {
                Id = JsonSerializer.SerializeToElement(42),
                SourceCode = code,
                Name = code + " Farms",
                ActiveYN = "Y",
                IndustryCode1 = "PR",
                MdmMasterRecord = JsonSerializer.SerializeToElement(true)
            }).ToList();
            var page = new CtrmPage<CtrmCustomerDto>
            {
                TotalCount = items.Count,
                PageInfo = new CtrmPageInfo { Skip = 0, Take = CtrmCustomerReader.SourceCodesPageSize, HasNextPage = false },
                Items = items
            };
            object data = new Dictionary<string, CtrmPage<CtrmCustomerDto>> { ["customers"] = page };
            return Task.FromResult(new CtrmReadResult<T> { Status = CtrmReadStatus.Ok, HttpStatus = 200, Value = (T)data });
        }
    }

    // -------------------------------------------------------------------------
    // The lane. PROD 2026-10-28: a rep onboarding a new producer into a trade unit had three saves held for ten
    // minutes in the background CTRM pool while a keep-warm cycle drained; the browser reported each as
    // failed, and the fourth went through once the cycle finished. Runs the real reader, not the seam.
    [Fact]
    public async Task AssignTradeUnitsAsync_OnboardingByCode_CompletesWhileTheBackgroundPoolIsFull()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["CustomerSync:Source"] = "ctrm",
            ["Ctrm:TradeUnitMaxConcurrentRequests"] = "1",
            ["Ctrm:BackgroundMaxDeferSeconds"] = "0"
        }).Build();

        // Keep-warm's stand-in: hold the only background slot for the whole save.
        var release = new TaskCompletionSource();
        var holding = new TaskCompletionSource();
        var holder = CtrmTradeUnitThrottle.RunAsync(config, async () =>
        {
            holding.SetResult();
            await release.Task;
            return 0;
        });
        await holding.Task;

        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"onb-lane-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"onb-lane-app-{Guid.NewGuid()}").Options);
        var sync = new Mock<ICustomerSyncRepository>(MockBehavior.Strict);
        sync.Setup(s => s.ReserveCustomerIdsAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync([MintedId]);
        var client = new OneRowPerCodeClient();
        var sut = new CustomerRepository(ods, app,
            new Mock<ITicketRepository>(MockBehavior.Strict).Object,
            new Mock<IContractRepository>(MockBehavior.Strict).Object,
            new Mock<ILogger<CustomerRepository>>().Object,
            config,
            new CtrmCustomerReader(client, config, NullLogger<CtrmCustomerReader>.Instance),
            sync.Object);

        try
        {
            var outcome = await sut
                .AssignTradeUnitsAsync(CtrmCustomerCandidateId.From("LANEFRM"), ["1340"], "LANEFRM", "rep@scoular.com", CancellationToken.None)
                .WaitAsync(TimeSpan.FromSeconds(10));

            Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
            Assert.Equal(MintedId, outcome.CustomerId);
            Assert.Equal(1, client.Calls);
            var tu = Assert.Single(app.CustomerTradeUnits);
            Assert.Equal("1340", tu.TradeUnit);
            Assert.True(tu.IsManual);
        }
        finally
        {
            release.SetResult();
            await holder;
        }
    }
}
