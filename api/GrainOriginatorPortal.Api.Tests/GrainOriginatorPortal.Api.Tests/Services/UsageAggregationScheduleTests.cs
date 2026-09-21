// Project namespaces
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The aggregation service's scheduling arithmetic. An off-by-one in the day boundary or the
/// day-of-week check doesn't throw — it silently skips a weekly rollup, or runs one twice for the
/// wrong week — and the dashboard then shows numbers that are merely wrong rather than missing.
/// The hourly loop meant these branches were only ever exercised against a live database.
/// </summary>
public class UsageAggregationScheduleTests
{
    // -------------------------------------------------------------------------
    // TargetDayFor — always yesterday (UTC), because today is still accumulating.
    // -------------------------------------------------------------------------

    [Fact]
    public void TargetDayFor_ReturnsYesterday()
    {
        var now = new DateTime(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 20), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    [Fact]
    public void TargetDayFor_JustAfterMidnight_StillReturnsThePreviousDay()
    {
        // The tick that matters: 00:30 UTC on the 21st must aggregate the 20th, not the 19th.
        var now = new DateTime(2026, 9, 21, 0, 30, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 20), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    [Fact]
    public void TargetDayFor_JustBeforeMidnight_ReturnsTheDayBefore()
    {
        var now = new DateTime(2026, 9, 21, 23, 59, 59, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 20), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    [Fact]
    public void TargetDayFor_CrossesAMonthBoundary()
    {
        var now = new DateTime(2026, 10, 1, 1, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 30), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    [Fact]
    public void TargetDayFor_CrossesAYearBoundary()
    {
        var now = new DateTime(2027, 1, 1, 1, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 12, 31), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    [Fact]
    public void TargetDayFor_HandlesALeapDay()
    {
        var now = new DateTime(2028, 3, 1, 1, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2028, 2, 29), UsageAggregationBackgroundService.TargetDayFor(now));
    }

    // -------------------------------------------------------------------------
    // ShouldAggregateDay — once per day, but always once after a restart.
    // -------------------------------------------------------------------------

    [Fact]
    public void ShouldAggregateDay_WhenNothingAggregatedYet_IsTrue()
    {
        // Null = fresh process. The first cycle must run, or a restart right after midnight
        // would skip the day entirely.
        Assert.True(UsageAggregationBackgroundService.ShouldAggregateDay(new DateOnly(2026, 9, 20), null));
    }

    [Fact]
    public void ShouldAggregateDay_WhenAlreadyDoneForThatDay_IsFalse()
    {
        var day = new DateOnly(2026, 9, 20);

        // Stops the hourly loop re-running the same day twelve more times.
        Assert.False(UsageAggregationBackgroundService.ShouldAggregateDay(day, day));
    }

    [Fact]
    public void ShouldAggregateDay_WhenTheDateHasRolledOver_IsTrue()
    {
        Assert.True(UsageAggregationBackgroundService.ShouldAggregateDay(
            new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 20)));
    }

    [Fact]
    public void ShouldAggregateDay_WhenTheMarkerIsAheadOfTheTarget_IsTrue()
    {
        // Shouldn't happen, but "different" rather than "newer" is the safe reading: re-running is
        // a full recompute, so acting is harmless while skipping loses a day.
        Assert.True(UsageAggregationBackgroundService.ShouldAggregateDay(
            new DateOnly(2026, 9, 20), new DateOnly(2026, 9, 21)));
    }

    // -------------------------------------------------------------------------
    // The weekly rollup — the branch most likely to be quietly wrong.
    // -------------------------------------------------------------------------

    [Fact]
    public void ClosesOutAWeek_OnlyOnSunday()
    {
        // 2026-09-20 is a Sunday. Walk a full week so exactly one day qualifies.
        var sunday = new DateOnly(2026, 9, 20);
        Assert.Equal(DayOfWeek.Sunday, sunday.DayOfWeek);

        var qualifying = Enumerable.Range(0, 7)
            .Select(i => sunday.AddDays(i))
            .Where(UsageAggregationBackgroundService.ClosesOutAWeek)
            .ToList();

        Assert.Single(qualifying);
        Assert.Equal(sunday, qualifying[0]);
    }

    [Fact]
    public void WeekStartFor_ReturnsTheMondaySixDaysEarlier()
    {
        var sunday = new DateOnly(2026, 9, 20);

        var start = UsageAggregationBackgroundService.WeekStartFor(sunday);

        Assert.Equal(new DateOnly(2026, 9, 14), start);
        // The rollup window must be a Monday-to-Sunday week, inclusive.
        Assert.Equal(DayOfWeek.Monday, start.DayOfWeek);
        Assert.Equal(6, sunday.DayNumber - start.DayNumber);
    }

    [Fact]
    public void WeekStartFor_CrossesAMonthBoundary()
    {
        // Sunday 2026-10-04 → Monday 2026-09-28.
        var sunday = new DateOnly(2026, 10, 4);
        Assert.Equal(DayOfWeek.Sunday, sunday.DayOfWeek);

        Assert.Equal(new DateOnly(2026, 9, 28), UsageAggregationBackgroundService.WeekStartFor(sunday));
    }

    [Fact]
    public void TheRollupLandsOnMonday_ForTheWeekThatJustEnded()
    {
        // End to end through the two decisions, from the clock: a cycle running Monday morning
        // rolls up the Monday-to-Sunday week that finished the day before.
        var mondayMorning = new DateTime(2026, 9, 21, 2, 0, 0, DateTimeKind.Utc);
        Assert.Equal(DayOfWeek.Monday, mondayMorning.DayOfWeek);

        var target = UsageAggregationBackgroundService.TargetDayFor(mondayMorning);

        Assert.True(UsageAggregationBackgroundService.ClosesOutAWeek(target));
        Assert.Equal(new DateOnly(2026, 9, 14), UsageAggregationBackgroundService.WeekStartFor(target));
    }

    [Fact]
    public void NoRollupOnAnyOtherDayOfTheWeek()
    {
        // Every other daily cycle must NOT trigger a weekly rollup, or a week gets counted
        // repeatedly against shifting windows.
        for (var i = 1; i < 7; i++)
        {
            var cycleTime = new DateTime(2026, 9, 21, 2, 0, 0, DateTimeKind.Utc).AddDays(i);
            var target = UsageAggregationBackgroundService.TargetDayFor(cycleTime);

            Assert.False(UsageAggregationBackgroundService.ClosesOutAWeek(target),
                $"cycle at {cycleTime:yyyy-MM-dd} (target {target}) should not close out a week");
        }
    }

    // -------------------------------------------------------------------------
    // IsDue — the interval gates.
    // -------------------------------------------------------------------------

    [Fact]
    public void IsDue_WhenNeverRun_IsTrue()
    {
        var now = new DateTime(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);

        Assert.True(UsageAggregationBackgroundService.IsDue(now, DateTime.MinValue, TimeSpan.FromHours(6)));
    }

    [Fact]
    public void IsDue_ExactlyAtTheInterval_IsTrue()
    {
        // Boundary: >= not >. With > and an hourly loop, a 6-hour job would drift an hour later
        // every time it fired.
        var now = new DateTime(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);
        var lastRun = now.AddHours(-6);

        Assert.True(UsageAggregationBackgroundService.IsDue(now, lastRun, TimeSpan.FromHours(6)));
    }

    [Fact]
    public void IsDue_JustBeforeTheInterval_IsFalse()
    {
        var now = new DateTime(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);
        var lastRun = now.AddHours(-6).AddSeconds(1);

        Assert.False(UsageAggregationBackgroundService.IsDue(now, lastRun, TimeSpan.FromHours(6)));
    }

    [Fact]
    public void IsDue_WellPastTheInterval_IsTrue()
    {
        var now = new DateTime(2026, 9, 21, 13, 0, 0, DateTimeKind.Utc);

        Assert.True(UsageAggregationBackgroundService.IsDue(now, now.AddDays(-3), TimeSpan.FromHours(24)));
    }
}
