// Project namespaces
using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// Pins the screen-time inference: there is no screen_exit event, so time on a screen is the gap to
/// the next screen_enter, oversized gaps are discarded rather than counted, and the final event of a
/// sequence gets a fixed one minute.
/// </summary>
public class ScreenTimeCalculatorTests
{
    private static readonly DateTime T0 = new(2026, 7, 15, 9, 0, 0, DateTimeKind.Utc);

    private static ScreenEnterEvent Event(string user, string feature, int minutesFromT0) =>
        new(user, feature, T0.AddMinutes(minutesFromT0));

    [Fact]
    public void MinutesByFeature_CountsTheGapToTheNextScreen()
    {
        var events = new[]
        {
            Event("CEgr", "customers", 0),
            Event("CEgr", "build-a-list", 5),   // 5 minutes on customers
            Event("CEgr", "customers", 12),     // 7 minutes on build-a-list
        };

        var minutes = ScreenTimeCalculator.MinutesByFeature(events);

        // 5 on customers + the trailing minute for the last (also customers) event = 6.
        Assert.Equal(6, minutes["customers"]);
        Assert.Equal(7, minutes["build-a-list"]);
    }

    [Fact]
    public void MinutesByFeature_DiscardsGapsOverTheCap_RatherThanCountingThem()
    {
        // A 3-hour gap means the user walked away, not that they stared at the screen for 3 hours.
        var events = new[]
        {
            Event("CEgr", "customers", 0),
            Event("CEgr", "bidsheet", 180),
        };

        var minutes = ScreenTimeCalculator.MinutesByFeature(events);

        Assert.False(minutes.ContainsKey("customers")); // over the cap → contributed nothing
        Assert.Equal(ScreenTimeCalculator.TrailingMinutes, minutes["bidsheet"]);
    }

    [Fact]
    public void MinutesByFeature_GapExactlyAtTheCap_IsCounted()
    {
        var events = new[]
        {
            Event("CEgr", "customers", 0),
            Event("CEgr", "bidsheet", (int)ScreenTimeCalculator.MaxGapMinutes),
        };

        var minutes = ScreenTimeCalculator.MinutesByFeature(events);

        Assert.Equal(ScreenTimeCalculator.MaxGapMinutes, minutes["customers"]);
    }

    [Fact]
    public void MinutesByFeature_SingleEvent_GetsTheTrailingMinute()
    {
        // Known floor of this approach: a long visit with no further navigation reads as one minute.
        var minutes = ScreenTimeCalculator.MinutesByFeature([Event("CEgr", "insights", 0)]);

        Assert.Equal(ScreenTimeCalculator.TrailingMinutes, minutes["insights"]);
    }

    [Fact]
    public void MinutesByFeature_DoesNotBridgeAcrossUsers()
    {
        // Two users' events interleave in the source rows; one user's navigation must not be read as
        // the other user's dwell time.
        var events = new[]
        {
            Event("CEgr", "customers", 0),
            Event("KHague", "bidsheet", 3),
            Event("CEgr", "insights", 8),
        };

        var minutes = ScreenTimeCalculator.MinutesByFeature(events);

        Assert.Equal(8, minutes["customers"]);                                  // 0 → 8, CEgr's own next event
        Assert.Equal(ScreenTimeCalculator.TrailingMinutes, minutes["bidsheet"]);  // KHague's only event
        Assert.Equal(ScreenTimeCalculator.TrailingMinutes, minutes["insights"]);  // CEgr's last event
    }

    [Fact]
    public void MinutesByFeature_HandlesUnorderedInput()
    {
        var ordered = ScreenTimeCalculator.MinutesByFeature(
        [
            Event("CEgr", "customers", 0),
            Event("CEgr", "bidsheet", 4),
        ]);
        var shuffled = ScreenTimeCalculator.MinutesByFeature(
        [
            Event("CEgr", "bidsheet", 4),
            Event("CEgr", "customers", 0),
        ]);

        Assert.Equal(ordered, shuffled);
    }

    [Fact]
    public void MinutesByUserAndFeature_KeepsUsersSeparate()
    {
        var events = new[]
        {
            Event("CEgr", "customers", 0),
            Event("CEgr", "bidsheet", 6),
            Event("KHague", "customers", 0),
            Event("KHague", "insights", 10),
        };

        var minutes = ScreenTimeCalculator.MinutesByUserAndFeature(events);

        Assert.Equal(6, minutes[("CEgr", "customers")]);
        Assert.Equal(10, minutes[("KHague", "customers")]);
    }

    [Fact]
    public void MinutesByDayAndFeature_AttributesTimeToTheDayOfTheEvent()
    {
        var lateNight = new DateTime(2026, 7, 15, 23, 50, 0, DateTimeKind.Utc);
        var events = new[]
        {
            new ScreenEnterEvent("CEgr", "customers", lateNight),
            new ScreenEnterEvent("CEgr", "bidsheet", lateNight.AddMinutes(15)), // 00:05 next day
        };

        var minutes = ScreenTimeCalculator.MinutesByDayAndFeature(events);

        // The 15 minutes are credited to the screen the user was *on*, i.e. the 15th.
        Assert.Equal(15, minutes[(new DateTime(2026, 7, 15), "customers")]);
        Assert.Equal(ScreenTimeCalculator.TrailingMinutes, minutes[(new DateTime(2026, 7, 16), "bidsheet")]);
    }

    [Fact]
    public void MinutesByFeature_NoEvents_ReturnsEmpty()
    {
        Assert.Empty(ScreenTimeCalculator.MinutesByFeature([]));
    }
}
