// Project namespaces
using GrainOriginatorPortal.Api.Platform.Middleware;
using GrainOriginatorPortal.Api.Platform.Telemetry;

namespace GrainOriginatorPortal.Api.Tests.Platform.Telemetry;

/// <summary>
/// The tracker is what keeps job-title capture cheap: every request carries the claim, and only
/// first sightings (since start-up) and changes may reach the database.
/// </summary>
public class JobTitleChangeTrackerTests
{
    private static UserActivityRecord Record(string userId, string? title, int minute = 0) => new()
    {
        UserId = userId,
        JobTitle = title,
        Timestamp = new DateTime(2026, 10, 27, 12, minute, 0, DateTimeKind.Utc)
    };

    [Fact]
    public void FirstSighting_IsReportedOnce_ThenRepeatsAreSilent()
    {
        var tracker = new JobTitleChangeTracker();

        var first = tracker.Observe([Record("CEgr", "Merchant"), Record("CEgr", "Merchant", 1)]);
        var second = tracker.Observe([Record("CEgr", "Merchant", 2)]);

        var only = Assert.Single(first);
        Assert.Equal("CEgr", only.UserId);
        Assert.Equal("Merchant", only.JobTitle);
        Assert.Empty(second);
    }

    [Fact]
    public void ChangedTitle_IsReported_WithTheTimeItWasSeen()
    {
        var tracker = new JobTitleChangeTracker();
        tracker.Observe([Record("CEgr", "Merchant")]);

        var changed = tracker.Observe([Record("CEgr", "Senior Merchant", 5)]);

        var only = Assert.Single(changed);
        Assert.Equal("Senior Merchant", only.JobTitle);
        Assert.Equal(5, only.ObservedAt.Minute);
    }

    [Fact]
    public void MissingClaim_IsARealObservation_BothFirstAndAsAChange()
    {
        // "No title in the directory" is a state the dashboard filters on, so a first sighting with
        // no title is written, and going from a title to none is written too.
        var tracker = new JobTitleChangeTracker();

        var first = tracker.Observe([Record("CEgr", null)]);
        tracker.Observe([Record("KHague", "Merchant")]);
        var cleared = tracker.Observe([Record("KHague", null, 1)]);

        Assert.Null(Assert.Single(first).JobTitle);
        Assert.Null(Assert.Single(cleared).JobTitle);
    }

    [Fact]
    public void LatestSightingWins_WhenAUserAppearsTwiceInABatch()
    {
        var tracker = new JobTitleChangeTracker();

        // Out of order on purpose: "latest" is by timestamp, not by arrival.
        var result = tracker.Observe([Record("CEgr", "Newer", 2), Record("CEgr", "Older", 1)]);

        Assert.Equal("Newer", Assert.Single(result).JobTitle);
        Assert.Empty(tracker.Observe([Record("CEgr", "Newer", 3)]));
    }

    [Fact]
    public void UserIds_AreMatchedCaseInsensitively()
    {
        var tracker = new JobTitleChangeTracker();
        tracker.Observe([Record("CEgr", "Merchant")]);

        Assert.Empty(tracker.Observe([Record("cegr", "Merchant", 1)]));
    }

    [Fact]
    public void Forget_MakesTheNextSightingCountAgain()
    {
        // The writer calls this when the upsert failed, so a transient DB error is retried on the
        // user's next request rather than waiting for their title to change.
        var tracker = new JobTitleChangeTracker();
        tracker.Observe([Record("CEgr", "Merchant")]);

        tracker.Forget(["CEgr"]);

        Assert.Single(tracker.Observe([Record("CEgr", "Merchant", 1)]));
    }
}
