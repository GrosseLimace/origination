using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Covers the guardrails on the BarChart ingestion path: payloads are screened before any database
/// work, every call is audited for vendor-usage tracking, and the payload itself never leaves the
/// service in a log or an audit row.
/// </summary>
public class BarchartIngestServiceTests
{
    private readonly IBarchartIngestRepository _repository = Substitute.For<IBarchartIngestRepository>();
    private readonly BarchartIngestService _sut;

    private const string ValidInstrumentsJson = """
        { "status": { "code": 200 }, "results": [ { "symbol": "ZCPQ26-27300-6916.CM" } ] }
        """;

    public BarchartIngestServiceTests()
    {
        _sut = new BarchartIngestService(_repository, NullLogger<BarchartIngestService>.Instance);
    }

    [Fact]
    public async Task LoadInstrumentsAsync_ValidPayload_FilesRowsAndAuditsTheCall()
    {
        _repository.LoadInstrumentsAsync(ValidInstrumentsJson, Arg.Any<CancellationToken>()).Returns(387);

        var result = await _sut.LoadInstrumentsAsync(ValidInstrumentsJson);

        Assert.Equal(387, result.RowsLoaded);
        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a => a.Endpoint == "ingest/instruments" && a.Success && a.RowsAffected == 387),
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("<xml>nope</xml>")]
    public async Task LoadInstrumentsAsync_UnusablePayload_ThrowsAndNeverTouchesTheDatabase(string payload)
    {
        await Assert.ThrowsAsync<ValidationException>(() => _sut.LoadInstrumentsAsync(payload));

        await _repository.DidNotReceive().LoadInstrumentsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await _repository.DidNotReceive().LogApiCallAsync(Arg.Any<BarchartApiCallAudit>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task LoadInstrumentsAsync_PayloadOverTheSizeLimit_Throws()
    {
        // One byte past the cap, wrapped so it is otherwise valid-looking JSON.
        var oversized = "[" + new string('x', BarchartIngestService.MaxPayloadBytes);

        var ex = await Assert.ThrowsAsync<ValidationException>(() => _sut.LoadInstrumentsAsync(oversized));

        Assert.Contains("exceeds", ex.Message, StringComparison.OrdinalIgnoreCase);
        await _repository.DidNotReceive().LoadInstrumentsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task LoadInstrumentsAsync_RepositoryFails_AuditsTheFailureAndRethrows()
    {
        _repository.LoadInstrumentsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<Task<int>>(_ => throw new InvalidOperationException("merge blew up"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => _sut.LoadInstrumentsAsync(ValidInstrumentsJson));

        // The call still consumed vendor allowance, so it must be recorded as a failure.
        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a => a.Endpoint == "ingest/instruments" && !a.Success),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task LoadQuotesAsync_ExplicitSnapshotDate_IsPassedThroughAndEchoedBack()
    {
        var businessDate = new DateOnly(2026, 7, 22);
        _repository.LoadQuotesAsync(Arg.Any<string>(), businessDate, Arg.Any<CancellationToken>())
            .Returns(new BarchartQuoteLoadResult { QuotesUpserted = 100, UnknownSymbolCount = 2 });

        var result = await _sut.LoadQuotesAsync(ValidInstrumentsJson, businessDate);

        Assert.Equal(100, result.QuotesUpserted);
        Assert.Equal(2, result.UnknownSymbolCount);
        Assert.Equal(businessDate, result.SnapshotDate);
    }

    [Fact]
    public async Task LoadQuotesAsync_NoSnapshotDate_DefaultsToTheCentralBusinessDate()
    {
        // Loads run late in the day Central, which can already be tomorrow in UTC — the business date
        // must never be taken from the UTC clock.
        _repository.LoadQuotesAsync(Arg.Any<string>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(new BarchartQuoteLoadResult { QuotesUpserted = 1, UnknownSymbolCount = 0 });
        var central = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        var expected = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, central));

        var result = await _sut.LoadQuotesAsync(ValidInstrumentsJson, snapshotDate: null);

        Assert.Equal(expected, result.SnapshotDate);
    }

    [Fact]
    public async Task AuditRecords_NeverContainThePayload()
    {
        // The body is third-party commercial data; only its size may be recorded.
        var payload = ValidInstrumentsJson;
        _repository.LoadInstrumentsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(1);

        await _sut.LoadInstrumentsAsync(payload);

        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a =>
                (a.QueryParams == null || !a.QueryParams.Contains("ZCPQ26"))
                && (a.ErrorMessage == null || !a.ErrorMessage.Contains("ZCPQ26"))),
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(1001)]
    public async Task GetQuoteBatchesAsync_BatchSizeOutOfRange_Throws(int batchSize)
    {
        await Assert.ThrowsAsync<ValidationException>(() => _sut.GetQuoteBatchesAsync(batchSize));

        await _repository.DidNotReceive().GetQuoteBatchesAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetQuoteBatchesAsync_ValidBatchSize_ReturnsTheBatchesFromTheRepository()
    {
        _repository.GetQuoteBatchesAsync(100, Arg.Any<CancellationToken>()).Returns(
        [
            new BarchartQuoteBatch { BatchNumber = 1, SymbolCount = 2, SymbolsCsv = "A.CM,B.CM" }
        ]);

        var batches = await _sut.GetQuoteBatchesAsync(100);

        var only = Assert.Single(batches);
        Assert.Equal(1, only.BatchNumber);
        Assert.Equal("A.CM,B.CM", only.SymbolsCsv);
    }

    [Fact]
    public async Task ApplyBidsAsync_StampsTheFeedActorSoWrittenCellsAreAttributableToTheFeed()
    {
        _repository.ApplyBidsToBidSheetAsync(
                Arg.Any<int?>(), Arg.Any<string?>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(12);

        var result = await _sut.ApplyBidsAsync(locationId: 42, instrumentType: "bidCash");

        Assert.Equal(12, result.RowsAffected);
        await _repository.Received(1).ApplyBidsToBidSheetAsync(42, "bidCash", "barchart-feed", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetBudgetAsync_ReturnsUsageAndTheAbortSignal()
    {
        _repository.GetApiBudgetAsync(250_000, Arg.Any<CancellationToken>())
            .Returns(new BarchartApiBudget
            {
                MonthToDateCalls = 200_000,
                RemainingCalls = 50_000,
                AbortRecommended = true
            });

        var result = await _sut.GetBudgetAsync(250_000);

        Assert.Equal(200_000, result.MonthToDateCalls);
        Assert.Equal(50_000, result.RemainingCalls);
        Assert.True(result.AbortRecommended);
    }

    [Fact]
    public async Task GetBudgetAsync_NonPositiveCap_Throws()
    {
        await Assert.ThrowsAsync<ValidationException>(() => _sut.GetBudgetAsync(0));

        await _repository.DidNotReceive().GetApiBudgetAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(29, 730)]   // audit window too short
    [InlineData(400, 89)]   // history window too short
    [InlineData(0, 0)]
    public async Task PurgeHistoryAsync_RetentionWindowTooShort_ThrowsAndDeletesNothing(
        int auditDays, int snapshotDays)
    {
        // Price history cannot be rebuilt from the vendor API, so an over-eager purge is refused
        // rather than quietly destroying it.
        await Assert.ThrowsAsync<ValidationException>(() => _sut.PurgeHistoryAsync(auditDays, snapshotDays));

        await _repository.DidNotReceive().PurgeHistoryAsync(
            Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PurgeHistoryAsync_ValidWindows_TrimsAndReportsRowsRemoved()
    {
        _repository.PurgeHistoryAsync(400, 730, Arg.Any<CancellationToken>()).Returns(1_500);

        var result = await _sut.PurgeHistoryAsync(400, 730);

        Assert.Equal(1_500, result.RowsRemoved);
    }
}
