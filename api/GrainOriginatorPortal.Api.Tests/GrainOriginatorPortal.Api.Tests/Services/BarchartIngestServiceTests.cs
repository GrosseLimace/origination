using GrainOriginatorPortal.Api.Exceptions;
using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Extensions.Configuration;
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
        _sut = CreateService(applyBidsEnabled: "true");
    }

    private BarchartIngestService CreateService(string? applyBidsEnabled, string? staleAfterDays = null)
    {
        var settings = new Dictionary<string, string?>();
        if (applyBidsEnabled != null) settings[BarchartIngestService.ApplyBidsEnabledSetting] = applyBidsEnabled;
        if (staleAfterDays != null) settings[BarchartFeedSettings.StaleAfterDaysSetting] = staleAfterDays;
        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new BarchartIngestService(
            _repository, config, new BarchartFeedSettings(config), NullLogger<BarchartIngestService>.Instance);
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
                Arg.Any<int?>(), Arg.Any<string?>(), Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(12);

        var result = await _sut.ApplyBidsAsync(locationId: 42, instrumentType: "bidCash");

        Assert.Equal(12, result.RowsAffected);
        Assert.True(result.Enabled);
        // No Barchart:StaleAfterDays configured, so the bridge runs under the shared default.
        await _repository.Received(1).ApplyBidsToBidSheetAsync(
            42, "bidCash", "barchart-feed", Arg.Any<int>(), BarchartFeedDefaults.StaleAfterDays, Arg.Any<CancellationToken>());
    }

    // The stale window is the environment's call (Barchart:StaleAfterDays), and the bridge has to run
    // under exactly that value: it decides whether a hand-typed cell may be taken back tonight.
    [Fact]
    public async Task ApplyBidsAsync_PassesTheConfiguredStaleWindowToTheBridge()
    {
        var sut = CreateService(applyBidsEnabled: "true", staleAfterDays: "21");
        _repository.ApplyBidsToBidSheetAsync(
                Arg.Any<int?>(), Arg.Any<string?>(), Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(1);

        await sut.ApplyBidsAsync(locationId: null, instrumentType: "bidCash");

        await _repository.Received(1).ApplyBidsToBidSheetAsync(
            null, "bidCash", "barchart-feed", Arg.Any<int>(), 21, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]      // not configured at all -- the default must be off
    [InlineData("false")]
    public async Task ApplyBidsAsync_SwitchedOff_WritesNothingButSucceedsAndAuditsTheSkip(string? setting)
    {
        // The pipeline runs apply-bids on schedule everywhere; an environment that is not ready to show fed
        // bids must answer success, or the integration team is paged nightly for a deliberate choice.
        var sut = CreateService(setting);

        var result = await sut.ApplyBidsAsync(locationId: null, instrumentType: "bidCash");

        Assert.Equal(0, result.RowsAffected);
        Assert.False(result.Enabled);
        await _repository.DidNotReceive().ApplyBidsToBidSheetAsync(
            Arg.Any<int?>(), Arg.Any<string?>(), Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a => a.Endpoint == "ingest/apply-bids" && a.Success
                && a.RowsAffected == 0 && a.QueryParams!.Contains("skipped=disabled")),
            Arg.Any<CancellationToken>());
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

    // -------------------------------------------------------------------------
    // Deactivation blast-radius guard.
    //
    // The vendor catalog sweep is sharded across several days, so on any single day only a fraction of
    // the book is re-seen. A cutoff picked as "yesterday" would retire almost everything and silently
    // empty every linked Bid Sheet location — the guard turns that into a refusal instead.

    [Fact]
    public async Task DeactivateInstrumentsAsync_WithinShareLimit_DeactivatesAndAudits()
    {
        var cutoff = new DateTime(2026, 8, 11, 0, 0, 0, DateTimeKind.Utc);
        _repository.PreviewDeactivationAsync(cutoff, Arg.Any<CancellationToken>())
            .Returns(new BarchartDeactivationImpact { ActiveCount = 10342, WouldDeactivate = 16 });
        _repository.DeactivateMissingInstrumentsAsync(cutoff, Arg.Any<CancellationToken>()).Returns(16);

        var result = await _sut.DeactivateInstrumentsAsync(cutoff);

        Assert.Equal(16, result.RowsDeactivated);
        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a => a.Success && a.Endpoint == "ingest/deactivate-instruments"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeactivateInstrumentsAsync_OverShareLimit_ThrowsAndChangesNothing()
    {
        var cutoff = new DateTime(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);
        _repository.PreviewDeactivationAsync(cutoff, Arg.Any<CancellationToken>())
            .Returns(new BarchartDeactivationImpact { ActiveCount = 10342, WouldDeactivate = 8864 });

        var ex = await Assert.ThrowsAsync<ValidationException>(() => _sut.DeactivateInstrumentsAsync(cutoff));

        Assert.Contains("8864 of 10342", ex.Message);
        Assert.Contains("sharded", ex.Message);
        await _repository.DidNotReceive().DeactivateMissingInstrumentsAsync(
            Arg.Any<DateTime>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeactivateInstrumentsAsync_RefusedCall_IsStillAuditedAsAFailure()
    {
        var cutoff = new DateTime(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);
        _repository.PreviewDeactivationAsync(cutoff, Arg.Any<CancellationToken>())
            .Returns(new BarchartDeactivationImpact { ActiveCount = 100, WouldDeactivate = 90 });

        await Assert.ThrowsAsync<ValidationException>(() => _sut.DeactivateInstrumentsAsync(cutoff));

        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a => !a.Success && a.HttpStatus == 400),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeactivateInstrumentsAsync_ExplicitHigherLimit_AllowsALargeRetirement()
    {
        var cutoff = new DateTime(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);
        _repository.PreviewDeactivationAsync(cutoff, Arg.Any<CancellationToken>())
            .Returns(new BarchartDeactivationImpact { ActiveCount = 100, WouldDeactivate = 90 });
        _repository.DeactivateMissingInstrumentsAsync(cutoff, Arg.Any<CancellationToken>()).Returns(90);

        var result = await _sut.DeactivateInstrumentsAsync(cutoff, maxSharePercent: 95);

        Assert.Equal(90, result.RowsDeactivated);
    }

    // An empty catalog must not divide by zero, and there is nothing to protect.
    [Fact]
    public async Task DeactivateInstrumentsAsync_EmptyCatalog_ProceedsWithoutError()
    {
        var cutoff = new DateTime(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);
        _repository.PreviewDeactivationAsync(cutoff, Arg.Any<CancellationToken>())
            .Returns(new BarchartDeactivationImpact { ActiveCount = 0, WouldDeactivate = 0 });
        _repository.DeactivateMissingInstrumentsAsync(cutoff, Arg.Any<CancellationToken>()).Returns(0);

        var result = await _sut.DeactivateInstrumentsAsync(cutoff);

        Assert.Equal(0, result.RowsDeactivated);
    }

    // -------------------------------------------------------------------------
    // quote-batches is audited even though it is a read and costs no vendor quota. It is the first step
    // of the pipeline's quote run, so its audit row is how we answer "did the loader reach us at all?" —
    // a run can succeed on the caller's side and never arrive (an auth failure never reaches this
    // service), and with no row there is nothing to separate "not called" from "called and fine".
    [Fact]
    public async Task GetQuoteBatchesAsync_AuditsTheCall_SoArrivalIsProvable()
    {
        _repository.GetQuoteBatchesAsync(100, Arg.Any<CancellationToken>()).Returns(
        [
            new BarchartQuoteBatch { BatchNumber = 1, SymbolCount = 100, SymbolsCsv = "A,B" },
            new BarchartQuoteBatch { BatchNumber = 2, SymbolCount = 42, SymbolsCsv = "C" }
        ]);

        var result = await _sut.GetQuoteBatchesAsync(100);

        Assert.Equal(2, result.Count);
        await _repository.Received(1).LogApiCallAsync(
            Arg.Is<BarchartApiCallAudit>(a =>
                a.Endpoint == "ingest/quote-batches" && a.Success && a.RowsAffected == 2),
            Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1001)]
    public async Task GetQuoteBatchesAsync_BatchSizeOutOfRange_ThrowsWithoutTouchingTheRepository(int batchSize)
    {
        await Assert.ThrowsAsync<ValidationException>(() => _sut.GetQuoteBatchesAsync(batchSize));

        await _repository.DidNotReceive().GetQuoteBatchesAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }
}
