// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Onboarding a producer from the ODS search must never create a second dbo.Customer row for a
/// producer the sync already holds. With the CTRM sync a producer can live under a minted id
/// (5e15+N) while the ODS still offers it under its ODS id; the two share only the ScoularId.
/// The ODS SQL cannot run on the InMemory provider, so the tests override the two candidate seams.
/// </summary>
public class CustomerRepositoryOnboardingTests
{
    private const long MintedId = 5_000_000_000_000_042;

    private sealed class TestableCustomerRepository : CustomerRepository
    {
        public TestableCustomerRepository(OriginationDbContext ods, ApplicationDbContext app)
            : base(ods, app,
                new Mock<ITicketRepository>(MockBehavior.Strict).Object,
                new Mock<IContractRepository>(MockBehavior.Strict).Object,
                new Mock<ILogger<CustomerRepository>>().Object, new ConfigurationBuilder().Build())
        {
        }

        public List<Customer> Candidates { get; } = [];                        // what the "ODS" would return for any term
        public Customer? Candidate { get; set; }                               // what the "ODS" would return for LoadOnboardingCandidateAsync (A9)
        public int CandidateLoads { get; private set; }

        protected override Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken ct) =>
            Task.FromResult(Candidates.ToList());

        protected override Task<Customer?> LoadOnboardingCandidateAsync(long customerId, CancellationToken ct)
        {
            CandidateLoads++;
            return Task.FromResult(Candidate);
        }
    }

    private static TestableCustomerRepository Build(out ApplicationDbContext app)
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"onb-ods-{Guid.NewGuid()}").Options);
        app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"onb-app-{Guid.NewGuid()}").Options);
        return new TestableCustomerRepository(ods, app);
    }

    private static Customer OdsCandidate(long id, string? scoularId) =>
        new() { Id = id, ScoularId = scoularId, Name = $"Candidate {id}", IsActive = true };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SearchOdsAsync_DropsCandidatesWhoseIdIsAlreadyOnboarded()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = 777, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();
        sut.Candidates.AddRange([OdsCandidate(777, "SMITFAR"), OdsCandidate(778, "JONES")]);

        var result = await sut.SearchOdsAsync("smith", CancellationToken.None);

        Assert.Equal([778L], result.Select(c => c.Id));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SearchOdsAsync_DropsCandidatesWhoseScoularIdIsAlreadyOnboarded_UnderADifferentId()
    {
        // The sync minted this producer; the ODS still offers it under its ODS id. Codes are seeded
        // trimmed on the app side (the InMemory provider does not ignore trailing spaces) and padded
        // on the candidate side.
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = MintedId, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();
        sut.Candidates.AddRange([OdsCandidate(777, "smitfar "), OdsCandidate(778, "JONES")]);

        var result = await sut.SearchOdsAsync("smith", CancellationToken.None);

        Assert.Equal([778L], result.Select(c => c.Id));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task SearchOdsAsync_CandidateWithBlankScoularId_IsKeptUnlessItsIdIsOnboarded()
    {
        // Blank codes never match anything — not even an app row with a blank code.
        var sut = Build(out var app);
        app.Customers.AddRange(
            new Customer { Id = 500, ScoularId = null, Name = "No Code Farm", IsActive = true },
            new Customer { Id = 501, ScoularId = "", Name = "Empty Code Farm", IsActive = true },
            new Customer { Id = 780, ScoularId = null, Name = "Onboarded No Code", IsActive = true });
        app.SaveChanges();
        sut.Candidates.AddRange([OdsCandidate(779, null), OdsCandidate(781, "  "), OdsCandidate(780, null)]);

        var result = await sut.SearchOdsAsync("farm", CancellationToken.None);

        Assert.Equal([779L, 781L], result.Select(c => c.Id));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_UnknownId_WithAnExistingRowOfTheSameScoularId_AdoptsIt_AndInsertsNoCustomer()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = MintedId, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();
        sut.Candidate = OdsCandidate(777, "smitfar");

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(MintedId, outcome.CustomerId);
        Assert.True(outcome.Adopted);
        Assert.Equal(1, app.Customers.Count());
        var tu = Assert.Single(app.CustomerTradeUnits);
        Assert.Equal(MintedId, tu.CustomerId);
        Assert.Equal("1085", tu.TradeUnit);
        Assert.True(tu.IsManual);
        Assert.True(tu.IsActive);
        Assert.False(app.CustomerTradeUnits.Any(t => t.CustomerId == 777));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_Adoption_AddsThePostedCodes_AndKeepsPreExistingManualTradeUnits()
    {
        // The client posted the codes for an ODS candidate it thought was new — not the adopted row's
        // full manual list — so adoption must not reconcile away a manual trade unit it never saw.
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = MintedId, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.CustomerTradeUnits.Add(new CustomerTradeUnit
        {
            CustomerId = MintedId,
            TradeUnit = "2190",
            IsActive = true,
            IsManual = true,
            CreatedAt = DateTime.UtcNow.AddDays(-30),
            CreatedBy = "other.rep@scoular.com",
            ModifiedAt = null,
        });
        app.SaveChanges();
        sut.Candidate = OdsCandidate(777, "SMITFAR");

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.True(outcome.Adopted);
        var rows = app.CustomerTradeUnits.Where(t => t.CustomerId == MintedId).OrderBy(t => t.TradeUnit).ToList();
        Assert.Equal(["1085", "2190"], rows.Select(t => t.TradeUnit));
        Assert.All(rows, t => Assert.True(t.IsActive));
        Assert.All(rows, t => Assert.True(t.IsManual));
        Assert.Null(rows.Single(t => t.TradeUnit == "2190").ModifiedAt);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_KnownId_StillReconcilesToThePostedList()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = 900, ScoularId = "JONES1", Name = "Jones Farm", IsActive = true });
        app.CustomerTradeUnits.Add(new CustomerTradeUnit
        {
            CustomerId = 900,
            TradeUnit = "2190",
            IsActive = true,
            IsManual = true,
            CreatedAt = DateTime.UtcNow.AddDays(-30),
            CreatedBy = "other.rep@scoular.com",
        });
        app.SaveChanges();

        var outcome = await sut.AssignTradeUnitsAsync(900, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.False(outcome.Adopted);
        Assert.False(app.CustomerTradeUnits.Single(t => t.CustomerId == 900 && t.TradeUnit == "2190").IsActive);
        Assert.True(app.CustomerTradeUnits.Single(t => t.CustomerId == 900 && t.TradeUnit == "1085").IsActive);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_Adoption_PrefersTheActiveRow_ThenTheLowestId()
    {
        var sut = Build(out var app);
        app.Customers.AddRange(
            new Customer { Id = MintedId + 8, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = false },
            new Customer { Id = MintedId, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true },
            new Customer { Id = 900, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();
        sut.Candidate = OdsCandidate(777, "SMITFAR");

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(900L, outcome.CustomerId);
        Assert.True(outcome.Adopted);
        Assert.Equal(3, app.Customers.Count());
        Assert.Equal(900L, Assert.Single(app.CustomerTradeUnits).CustomerId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_Adoption_ReactivatesAnInactiveRow_AsManual()
    {
        var sut = Build(out var app);
        app.Customers.AddRange(
            new Customer { Id = MintedId + 8, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = false, IsManual = false },
            new Customer { Id = MintedId, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = false, IsManual = false });
        app.SaveChanges();
        sut.Candidate = OdsCandidate(777, "SMITFAR");

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(MintedId, outcome.CustomerId);
        Assert.True(outcome.Adopted);
        var adopted = app.Customers.Single(c => c.Id == MintedId);
        Assert.True(adopted.IsActive);
        Assert.True(adopted.IsManual);
        Assert.False(app.Customers.Single(c => c.Id == MintedId + 8).IsActive);
        Assert.Equal(2, app.Customers.Count());
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_UnknownId_NoRowWithThatScoularId_StillInsertsFromTheCandidate()
    {
        var sut = Build(out var app);
        app.Customers.Add(new Customer { Id = 900, ScoularId = "JONES", Name = "Jones Farm", IsActive = true });
        app.SaveChanges();
        sut.Candidate = OdsCandidate(777, "SMITFAR");

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(777L, outcome.CustomerId);
        Assert.False(outcome.Adopted);
        var inserted = app.Customers.Single(c => c.Id == 777);
        Assert.True(inserted.IsManual);
        Assert.True(inserted.IsActive);
        Assert.Equal(777L, Assert.Single(app.CustomerTradeUnits).CustomerId);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_UnknownId_EmptyCodes_ReturnsNoCodes_WithoutLoadingTheCandidate()
    {
        var sut = Build(out var app);
        sut.Candidate = OdsCandidate(777, "SMITFAR");

        var outcome = await sut.AssignTradeUnitsAsync(777, [" ", ""], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.NoCodes, outcome.Result);
        Assert.Equal(777L, outcome.CustomerId);
        Assert.False(outcome.Adopted);
        Assert.Equal(0, sut.CandidateLoads);
        Assert.Empty(app.Customers);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_UnknownId_CandidateMissing_ReturnsCustomerNotFound()
    {
        var sut = Build(out var app);
        sut.Candidate = null;

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.CustomerNotFound, outcome.Result);
        Assert.Equal(777L, outcome.CustomerId);
        Assert.False(outcome.Adopted);
        Assert.Equal(1, sut.CandidateLoads);
        Assert.Empty(app.Customers);
        Assert.Empty(app.CustomerTradeUnits);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AssignTradeUnitsAsync_KnownId_ReturnsOkWithTheSameId_NotAdopted()
    {
        // A known id never reads the ODS and never looks for another row, even one with the same code.
        var sut = Build(out var app);
        app.Customers.AddRange(
            new Customer { Id = 777, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true },
            new Customer { Id = 500, ScoularId = "SMITFAR", Name = "Smith Farms", IsActive = true });
        app.SaveChanges();

        var outcome = await sut.AssignTradeUnitsAsync(777, ["1085"], null, "rep@scoular.com", CancellationToken.None);

        Assert.Equal(AssignTradeUnitsResult.Ok, outcome.Result);
        Assert.Equal(777L, outcome.CustomerId);
        Assert.False(outcome.Adopted);
        Assert.Equal(0, sut.CandidateLoads);
        Assert.Equal(777L, Assert.Single(app.CustomerTradeUnits).CustomerId);
    }
}
