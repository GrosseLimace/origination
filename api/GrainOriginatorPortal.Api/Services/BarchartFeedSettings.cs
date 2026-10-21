using GrainOriginatorPortal.Infrastructure.Abstractions;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>Per-environment knobs on the BarChart bid feed that more than one service has to agree on.</summary>
public interface IBarchartFeedSettings
{
    /// <summary>
    /// Days after the elevator's last update before a fed bid stops being trusted: the Bid Sheet shows
    /// "--" with the date instead of the number, and the feed may not take back a hand-typed cell with a
    /// quote this old. Defaults to <see cref="BarchartFeedDefaults.StaleAfterDays"/>.
    /// </summary>
    int StaleAfterDays { get; }

    /// <summary>
    /// Whether the Bid Sheet hides a fed bid older than <see cref="StaleAfterDays"/> behind "--" and
    /// its date. Off everywhere for now (user's call, 2026-10-21, after seeing a whole Dev sheet of
    /// blanks): the number shows, the hover says when it was last updated, and the takeover rule above
    /// still protects a hand-typed cell. Here rather than deleted so an environment can turn it on.
    /// </summary>
    bool HideStaleBids { get; }
}

/// <inheritdoc />
public sealed class BarchartFeedSettings(IConfiguration config) : IBarchartFeedSettings
{
    /// <summary>Configuration key; App Service spells it <c>Barchart__StaleAfterDays</c>.</summary>
    public const string StaleAfterDaysSetting = "Barchart:StaleAfterDays";

    /// <inheritdoc />
    // Read per call, like Barchart:ApplyBidsEnabled, so the answer always matches the environment's
    // current setting. TryParse rather than GetValue: a mistyped App Service value must fall back, not
    // throw on every apply-bids run and coverage read. Clamped so a typo can neither switch the rule off
    // (0) nor outlive the publish window: a bid older than MaxQuoteAgeDays is not on the sheet at all.
    public int StaleAfterDays => Math.Clamp(
        int.TryParse(config[StaleAfterDaysSetting], out var days) ? days : BarchartFeedDefaults.StaleAfterDays,
        1, BarchartFeedDefaults.MaxQuoteAgeDays);

    /// <summary>Configuration key; App Service spells it <c>Barchart__HideStaleBids</c>.</summary>
    public const string HideStaleBidsSetting = "Barchart:HideStaleBids";

    /// <inheritdoc />
    public bool HideStaleBids => bool.TryParse(config[HideStaleBidsSetting], out var hide) && hide;
}
