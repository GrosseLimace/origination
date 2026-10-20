// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Ctrm;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Onboarding on the <c>ctrm</c> customer source (plan E3/E4): the search routes to the CTRM seam, a candidate
/// carries a negative placeholder id, onboarding goes by ScoularId and mints the real id, and a placeholder
/// without a code cannot be onboarded. The CTRM reader itself is covered by CtrmCustomerReaderSearchTests;
/// here the seams are overridden, as the ODS tests do.
/// </summary>
public class CustomerRepositoryCtrmOnboardingTests
{
    private const long MintedId = 5_000_000_000_000_777;

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
}
