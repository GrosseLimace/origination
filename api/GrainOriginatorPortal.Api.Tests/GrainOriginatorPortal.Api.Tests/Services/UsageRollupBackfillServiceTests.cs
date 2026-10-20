// Microsoft namespaces
using Microsoft.Extensions.Logging;

// Third-party namespaces
using Moq;

// Project namespaces
using GrainOriginatorPortal.Api.Services.Diagnostics;
using GrainOriginatorPortal.Infrastructure.Interfaces;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Pins the backfill loop moved out of DiagnosticsController: the 1..90 clamp, oldest-first daily
/// order with all three daily rollups per day, weekly rollups only after every day exists and only
/// for Monday-start weeks, the summary log line, and that cancellation stops it before any write.
/// </summary>
public class UsageRollupBackfillServiceTests
{
    private readonly Mock<IUsageRepository> _repo = new();
    private readonly CapturingLogger<UsageRollupBackfillService> _logger = new();
    private readonly List<string> _calls = [];
    private readonly UsageRollupBackfillService _sut;

    public UsageRollupBackfillServiceTests()
    {
        _repo.Setup(r => r.AggregateUserActivityDailyAsync(It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
            .Callback<DateOnly, CancellationToken>((d, _) => _calls.Add($"activity:{d:yyyy-MM-dd}")).Returns(Task.CompletedTask);
        _repo.Setup(r => r.AggregateFeatureUsageDailyAsync(It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
            .Callback<DateOnly, CancellationToken>((d, _) => _calls.Add($"feature:{d:yyyy-MM-dd}")).Returns(Task.CompletedTask);
        _repo.Setup(r => r.AggregateUserFeatureUsageDailyAsync(It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
            .Callback<DateOnly, CancellationToken>((d, _) => _calls.Add($"userfeature:{d:yyyy-MM-dd}")).Returns(Task.CompletedTask);
        _repo.Setup(r => r.AggregateWeeklyLoginsAsync(It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()))
            .Callback<DateOnly, CancellationToken>((d, _) => _calls.Add($"weekly:{d:yyyy-MM-dd}")).Returns(Task.CompletedTask);
        _sut = new UsageRollupBackfillService(_repo.Object, _logger);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(1, 1)]
    [InlineData(45, 45)]
    [InlineData(90, 90)]
    [InlineData(500, 90)]
    public async Task ClampsDaysToTheRetentionWindow(int requested, int expectedDays)
    {
        var result = await _sut.BackfillAsync(requested, CancellationToken.None);

        Assert.Equal(expectedDays, result.DaysAggregated);
        _repo.Verify(r => r.AggregateUserActivityDailyAsync(It.IsAny<DateOnly>(), It.IsAny<CancellationToken>()), Times.Exactly(expectedDays));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task AggregatesOldestDayFirst_ThreeRollupsPerDay_ThenWeeklyAfterAllDays()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        await _sut.BackfillAsync(3, CancellationToken.None);

        var dailyCalls = _calls.Where(c => !c.StartsWith("weekly:")).ToList();
        var expectedDaily = new List<string>();
        for (var offset = 3; offset >= 1; offset--)
        {
            var d = today.AddDays(-offset).ToString("yyyy-MM-dd");
            expectedDaily.AddRange([$"activity:{d}", $"feature:{d}", $"userfeature:{d}"]);
        }
        Assert.Equal(expectedDaily, dailyCalls);

        // Every weekly call comes after the last daily call.
        var lastDaily = _calls.FindLastIndex(c => !c.StartsWith("weekly:"));
        var firstWeekly = _calls.FindIndex(c => c.StartsWith("weekly:"));
        Assert.True(firstWeekly > lastDaily);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task WeeklyRollups_AreMondayStart_OnePerWeekTouched_Ascending()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var result = await _sut.BackfillAsync(21, CancellationToken.None);

        var weekStarts = _calls.Where(c => c.StartsWith("weekly:"))
            .Select(c => DateOnly.ParseExact(c["weekly:".Length..], "yyyy-MM-dd"))
            .ToList();

        Assert.All(weekStarts, w => Assert.Equal(DayOfWeek.Monday, w.DayOfWeek));
        Assert.Equal(weekStarts.OrderBy(w => w), weekStarts);
        Assert.Equal(weekStarts.Distinct().Count(), weekStarts.Count);
        Assert.Equal(weekStarts.Count, result.WeeksAggregated);

        // Each aggregated day falls inside one of the weeks that was rolled up.
        for (var offset = 21; offset >= 1; offset--)
        {
            var d = today.AddDays(-offset);
            Assert.Contains(weekStarts, w => w <= d && d < w.AddDays(7));
        }
        // 21 days span either 3 or 4 Monday-start weeks depending on today's weekday.
        Assert.InRange(weekStarts.Count, 3, 4);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task LogsTheSummaryLine_WithDaysAndWeeks()
    {
        var result = await _sut.BackfillAsync(7, CancellationToken.None);

        var entry = Assert.Single(_logger.Entries, e => e.Message.StartsWith("Backfilled usage rollups"));
        Assert.Equal(LogLevel.Information, entry.Level);
        Assert.Equal(7, entry.Fields["Days"]);
        Assert.Equal(result.WeeksAggregated, entry.Fields["Weeks"]);
        Assert.Equal($"Backfilled usage rollups for 7 days ({result.WeeksAggregated} weeks)", entry.Message);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public async Task CancelledBeforeStart_ThrowsWithoutAnyWrite()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => _sut.BackfillAsync(10, cts.Token));

        Assert.Empty(_calls);
        Assert.Empty(_logger.Entries);
    }
}
