// System namespaces
using System.Text.RegularExpressions;

// Microsoft namespaces
using Microsoft.AspNetCore.Mvc;

// Project namespaces
using GrainOriginatorPortal.Api.Controllers;
using GrainOriginatorPortal.Api.Models.Responses;

namespace GrainOriginatorPortal.Api.Tests.Controllers;

/// <summary>
/// Covers the endpoint plus the hand-edited Content/whats-new.json it serves. The content guards
/// matter more than the endpoint test: without them a typo in the notes file surfaces as a 500 for
/// every user on the first request after a deploy, or as a wrong release being announced as new.
/// </summary>
public class WhatsNewControllerTests
{
    private static readonly string[] ValidKinds = ["added", "changed", "fixed"];
    private static readonly Regex VersionPattern = new(@"^\d{4}\.\d{2}\.\d+$", RegexOptions.Compiled);

    private readonly WhatsNewController _sut = new();

    #region Get

    [Fact]
    public void Get_ReturnsOkWithReleases()
    {
        // Act
        var result = _sut.Get();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var releases = Assert.IsAssignableFrom<IReadOnlyList<WhatsNewReleaseResponse>>(okResult.Value);
        Assert.NotEmpty(releases);
    }

    #endregion

    #region Embedded content guard

    [Fact]
    public void EmbeddedReleases_EveryReleaseHasVersionTitleDateAndItems()
    {
        // Arrange / Act
        var releases = WhatsNewController.Releases.Value;

        // Assert
        Assert.All(releases, release =>
        {
            Assert.False(string.IsNullOrWhiteSpace(release.Version));
            Assert.False(string.IsNullOrWhiteSpace(release.Title));
            Assert.NotEqual(default, release.ReleasedOn);
            Assert.NotEmpty(release.Items);
        });
    }

    [Fact]
    public void EmbeddedReleases_EveryItemHasKnownKindAndText()
    {
        // Arrange / Act
        var items = WhatsNewController.Releases.Value.SelectMany(r => r.Items);

        // Assert
        Assert.All(items, item =>
        {
            Assert.Contains(item.Kind, ValidKinds);
            Assert.False(string.IsNullOrWhiteSpace(item.Text));
        });
    }

    [Fact]
    public void EmbeddedReleases_GroupIsEitherAbsentOrMeaningful()
    {
        // A whitespace-only group would render as a blank heading. The client already treats it as
        // absent; this keeps the file from carrying one in the first place.

        // Arrange / Act
        var groups = WhatsNewController.Releases.Value
            .SelectMany(r => r.Items)
            .Select(i => i.Group)
            .Where(g => g is not null);

        // Assert
        Assert.All(groups, group => Assert.False(string.IsNullOrWhiteSpace(group)));
    }

    [Fact]
    public void EmbeddedReleases_GroupedItemsAreContiguousWithinARelease()
    {
        // Grouping is by consecutive runs, so a group name that appears, stops, and reappears
        // renders as two separate blocks under the same heading. That is almost always a
        // mis-ordered file rather than an intent.

        // Arrange / Act / Assert
        Assert.All(WhatsNewController.Releases.Value, release =>
        {
            var runs = new List<string?>();
            foreach (var item in release.Items)
            {
                if (runs.Count == 0 || runs[^1] != item.Group)
                    runs.Add(item.Group);
            }

            Assert.Equal(runs.Count, runs.Distinct().Count());
        });
    }

    [Fact]
    public void EmbeddedReleases_VersionsMatchSchemeAndAreUnique()
    {
        // Arrange / Act
        var versions = WhatsNewController.Releases.Value.Select(r => r.Version).ToList();

        // Assert
        Assert.All(versions, version => Assert.Matches(VersionPattern, version));
        Assert.Equal(versions.Count, versions.Distinct().Count());
    }

    [Fact]
    public void EmbeddedReleases_AreOrderedNewestFirst()
    {
        // The client treats index 0 as the current release, so a mis-ordered file would announce an
        // old release as new.

        // Arrange / Act
        var dates = WhatsNewController.Releases.Value.Select(r => r.ReleasedOn).ToList();

        // Assert
        Assert.Equal(dates.OrderByDescending(d => d), dates);
    }

    #endregion

    #region LoadReleases

    [Fact]
    public void LoadReleases_ThrowsWhenTheResourceIsMissing()
    {
        // A renamed file or a dropped <EmbeddedResource> must fail loudly, not serve an empty list
        // that would silently stop announcing every future release.

        // Act
        var ex = Assert.Throws<InvalidOperationException>(
            () => WhatsNewController.LoadReleases("GrainOriginatorPortal.Api.Content.does-not-exist.json"));

        // Assert
        Assert.Contains("EmbeddedResource", ex.Message);
    }

    #endregion
}
