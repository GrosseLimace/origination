// Project namespaces
using GrainOriginatorPortal.Infrastructure.Ctrm;

namespace GrainOriginatorPortal.Api.Tests.Repositories;

/// <summary>
/// Covers how a ticket lookback is sliced into server-legal date windows.
/// </summary>
/// <remarks>
/// This is pure arithmetic, but it is the kind that fails quietly. The <c>tickets</c> field requires a
/// bill-of-lading range and rejects anything wider than 366 days, so a longer lookback has to be split.
/// Get the boundary wrong by one day and either a day's tickets vanish, or a ticket on the seam is
/// fetched by two windows and shows up twice on screen.
/// </remarks>
public class CtrmTicketWindowTests
{
    private static readonly DateTime Today = new(2026, 8, 24);

    // -------------------------------------------------------------------------
    [Fact]
    public void NoWindowExceedsTheServerCap()
    {
        // The whole reason for slicing: a wider range is rejected outright with a VALIDATION error.
        var windows = CtrmTicketReader.BuildWindows(Today, lookbackDays: 1095);

        Assert.NotEmpty(windows);
        Assert.All(windows, w =>
            Assert.True((w.To - w.From).TotalDays <= CtrmQueries.MaxTicketRangeDays,
                $"{w.From:yyyy-MM-dd}..{w.To:yyyy-MM-dd} spans {(w.To - w.From).TotalDays} days"));
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void WindowsDoNotOverlap_SoNoTicketIsFetchedTwice()
    {
        // Both ends are inclusive server-side, so each window must start the day AFTER the previous ends.
        var windows = CtrmTicketReader.BuildWindows(Today, lookbackDays: 1095);

        for (var i = 1; i < windows.Count; i++)
        {
            var newer = windows[i - 1];
            var older = windows[i];
            Assert.Equal(newer.From.AddDays(-1), older.To);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void WindowsAreContiguous_SoNoDayIsSkipped()
    {
        var windows = CtrmTicketReader.BuildWindows(Today, lookbackDays: 1095);

        // Walk every day in the lookback and confirm exactly one window claims it.
        for (var d = Today.AddDays(-1095); d <= Today; d = d.AddDays(1))
        {
            var claiming = windows.Count(w => d >= w.From && d <= w.To);
            Assert.Equal(1, claiming);
        }
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TodayIsAlwaysCovered_WithHeadroomForClockSkew()
    {
        // The newest window reaches a day past today: the Db2 host's idea of "today" can differ from ours,
        // and a ticket written this morning must not fall outside the range.
        var windows = CtrmTicketReader.BuildWindows(Today, lookbackDays: 1095);

        Assert.Contains(windows, w => Today >= w.From && Today <= w.To);
        Assert.True(windows[0].To > Today);
    }

    // -------------------------------------------------------------------------
    [Theory]
    [InlineData(1, 1)]      // a single day still produces one usable window
    [InlineData(366, 1)]    // exactly the cap — must not split
    [InlineData(367, 2)]
    [InlineData(1095, 3)]   // the three-year default
    public void SliceCountMatchesTheLookback(int lookbackDays, int expectedWindows)
    {
        Assert.Equal(expectedWindows, CtrmTicketReader.BuildWindows(Today, lookbackDays).Count);
    }

    // -------------------------------------------------------------------------
    [Fact]
    public void TheOldestWindowStopsAtTheLookbackBoundary()
    {
        // Without the clamp the last slice would reach further back than asked, quietly widening the read.
        var windows = CtrmTicketReader.BuildWindows(Today, lookbackDays: 400);

        Assert.Equal(Today.AddDays(-400), windows[^1].From);
    }
}
