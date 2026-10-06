// Microsoft namespaces
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
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
                new Mock<ILogger<CustomerRepository>>().Object)
        {
        }

        public List<Customer> Candidates { get; } = [];                        // what the "ODS" would return for any term

        protected override Task<List<Customer>> QueryOnboardingCandidatesAsync(string searchTerm, CancellationToken ct) =>
            Task.FromResult(Candidates.ToList());
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
}
