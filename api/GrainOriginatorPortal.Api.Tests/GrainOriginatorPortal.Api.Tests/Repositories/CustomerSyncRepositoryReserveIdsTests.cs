// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// <c>ReserveCustomerIdsAsync</c> hands the CTRM customer sync a block of minted ids from
/// <c>dbo.CustomerIdSequence</c> in one round trip. Only the no-op path is testable here: the reservation itself
/// runs <c>sys.sp_sequence_get_range</c>, which the InMemory provider cannot execute (any raw SQL throws), so the
/// SQL path is first exercised by the first NON-dry CTRM sync that mints an id (a dry run uses placeholder ids and
/// never calls this method) — so verify the app identity can use the sequence (UPDATE on dbo.CustomerIdSequence)
/// before that run.
/// </summary>
public class CustomerSyncRepositoryReserveIdsTests
{
    private static CustomerSyncRepository Build()
    {
        var ods = new OriginationDbContext(new DbContextOptionsBuilder<OriginationDbContext>()
            .UseInMemoryDatabase($"reserve-ods-{Guid.NewGuid()}").Options);
        var app = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"reserve-app-{Guid.NewGuid()}").Options);
        return new CustomerSyncRepository(ods, app);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task ReserveCustomerIdsAsync_ZeroOrNegative_ReturnsEmpty_WithoutTouchingTheDatabase(int count)
    {
        // The InMemory provider throws on raw SQL, so reaching the database would fail this test.
        var sut = Build();

        var ids = await sut.ReserveCustomerIdsAsync(count, CancellationToken.None);

        Assert.Empty(ids);
    }
}
