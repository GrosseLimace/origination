using GrainOriginatorPortal.Api.Services;
using GrainOriginatorPortal.Infrastructure.Abstractions;
using Microsoft.Extensions.Configuration;

namespace GrainOriginatorPortal.Api.Tests.Services;

/// <summary>
/// The stale window decides what the Bid Sheet hides behind "--" and whether the feed may take a typed
/// cell back, so a missing or mistyped setting has to land somewhere safe rather than switch the rule off.
/// </summary>
public class BarchartFeedSettingsTests
{
    private static BarchartFeedSettings With(string? value)
    {
        var settings = new Dictionary<string, string?>();
        if (value != null) settings[BarchartFeedSettings.StaleAfterDaysSetting] = value;
        return new BarchartFeedSettings(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    }

    [Fact]
    public void StaleAfterDays_DefaultsToTheSharedConstantWhenUnset()
        => Assert.Equal(BarchartFeedDefaults.StaleAfterDays, With(null).StaleAfterDays);

    [Fact]
    public void StaleAfterDays_ReadsTheConfiguredValue()
        => Assert.Equal(21, With("21").StaleAfterDays);

    // 0 would make every fed bid stale the moment it lands; anything past the publish window would be
    // judging rows that are not on the sheet to be judged.
    [Theory]
    [InlineData("0", 1)]
    [InlineData("-5", 1)]
    [InlineData("400", BarchartFeedDefaults.MaxQuoteAgeDays)]
    public void StaleAfterDays_IsClampedToThePublishWindow(string configured, int expected)
        => Assert.Equal(expected, With(configured).StaleAfterDays);

    // A mistyped App Service value is read as unset. It must not throw: this is read on every
    // apply-bids run and every coverage call.
    [Fact]
    public void StaleAfterDays_FallsBackWhenTheValueIsNotANumber()
        => Assert.Equal(BarchartFeedDefaults.StaleAfterDays, With("ten").StaleAfterDays);

    private static BarchartFeedSettings WithHide(string? value)
    {
        var settings = new Dictionary<string, string?>();
        if (value != null) settings[BarchartFeedSettings.HideStaleBidsSetting] = value;
        return new BarchartFeedSettings(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    }

    // Off unless an environment says so: the "--" treatment was pulled back on 2026-10-21 and only the
    // hover and the takeover rule stayed on by default.
    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("nonsense", false)]
    [InlineData("true", true)]
    [InlineData("True", true)]
    public void HideStaleBids_IsOffUnlessConfiguredOn(string? configured, bool expected)
        => Assert.Equal(expected, WithHide(configured).HideStaleBids);
}
