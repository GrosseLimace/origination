// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Repositories;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Direct coverage of the two EF-backed members of <see cref="BarchartIngestRepository"/> against an
/// InMemory database: the vendor-call budget (which endpoints count, the month-to-date window, the 80%
/// abort line) and the audit append.
/// </summary>
/// <remarks>
/// Deliberately NOT tested here: everything else in the class. <c>LoadInstrumentsAsync</c>,
/// <c>LoadQuotesAsync</c>, <c>GetQuoteBatchesAsync</c>, <c>DeactivateMissingInstrumentsAsync</c>,
/// <c>PreviewDeactivationAsync</c>, <c>ApplyBidsToBidSheetAsync</c> and <c>PurgeHistoryAsync</c> are
/// multi-statement T-SQL batches (OPENJSON, MERGE, table variables, DELETE TOP loops) issued as ADO
/// commands over <c>GetDbConnection()</c>. The InMemory provider has no connection, so those need the
/// real-SQL harness.
/// </remarks>
public class BarchartIngestRepositoryTests
{
    private static (BarchartIngestRepository Sut, ApplicationDbContext Db) Build()
    {
        var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"barchart-{Guid.NewGuid()}").Options);
        return (new BarchartIngestRepository(db), db);
    }

    private static DateTime MonthStart
    {
        get { var now = DateTime.UtcNow; return new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc); }
    }

    private static BarchartApiCallAudit Call(string endpoint, DateTime at) => new()
    {
        Endpoint = endpoint, CalledAtUtc = at, Success = true
    };

    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetApiBudgetAsync_CountsOnlyVendorEndpoints_ThisMonth()
    {
        var (sut, db) = Build();
        var thisMonth = MonthStart.AddHours(1);
        db.BarchartApiCallAudits.AddRange(
            Call(VendorCallEndpoints.Instruments, thisMonth),
            Call(VendorCallEndpoints.Quotes, thisMonth),
            Call(VendorCallEndpoints.Quotes, MonthStart),                    // exactly at month start → counts
            Call("ingest/apply-bids", thisMonth),                            // internal endpoint → never counts
            Call(VendorCallEndpoints.Quotes, MonthStart.AddSeconds(-1)));    // last month → excluded
        await db.SaveChangesAsync();

        var budget = await sut.GetApiBudgetAsync(100, CancellationToken.None);

        Assert.Equal((3, 97, false), (budget.MonthToDateCalls, budget.RemainingCalls, budget.AbortRecommended));
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(10, 7, false)]   // 70% → keep going
    [InlineData(10, 8, true)]    // exactly 80% → stop non-essential loads
    [InlineData(10, 12, true)]   // over the cap: remaining goes negative, abort stays on
    [InlineData(0, 5, false)]    // no cap configured → never abort
    public async Task GetApiBudgetAsync_AbortLineIsEightyPercentOfTheCap(int cap, int calls, bool expectAbort)
    {
        var (sut, db) = Build();
        for (var i = 0; i < calls; i++)
            db.BarchartApiCallAudits.Add(Call(VendorCallEndpoints.Quotes, MonthStart.AddMinutes(i)));
        await db.SaveChangesAsync();

        var budget = await sut.GetApiBudgetAsync(cap, CancellationToken.None);

        Assert.Equal(calls, budget.MonthToDateCalls);
        Assert.Equal(cap - calls, budget.RemainingCalls);
        Assert.Equal(expectAbort, budget.AbortRecommended);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LogApiCallAsync_PersistsTheAuditRow()
    {
        var (sut, db) = Build();

        await sut.LogApiCallAsync(new BarchartApiCallAudit
        {
            Endpoint = VendorCallEndpoints.Quotes, CalledAtUtc = MonthStart, HttpStatus = 200, Success = true, RowsAffected = 42, DurationMs = 310
        }, CancellationToken.None);

        var row = await db.BarchartApiCallAudits.SingleAsync();
        Assert.True(row.ApiCallId > 0);
        Assert.Equal((200, true, 42, 310), (row.HttpStatus!.Value, row.Success, row.RowsAffected!.Value, row.DurationMs!.Value));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LogApiCallAsync_NullAudit_Throws()
    {
        var (sut, _) = Build();

        await Assert.ThrowsAsync<ArgumentNullException>(() => sut.LogApiCallAsync(null!, CancellationToken.None));
    }
}
