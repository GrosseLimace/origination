namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// One release entry from Content/whats-new.json. The releases are ordered newest first and
/// the first entry is treated as the current release, so <see cref="Version"/> is only ever
/// compared for equality — never parsed, ordered, or interpreted as a number.
/// </summary>
public class WhatsNewReleaseResponse
{
    /// <summary>Release identifier in the form YYYY.MM.N. Opaque to the code.</summary>
    public string Version { get; set; } = string.Empty;

    /// <summary>The date the release reached production.</summary>
    public DateOnly ReleasedOn { get; set; }

    /// <summary>Short, plain-language headline for the whole release.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>Optional one-sentence framing shown under the title.</summary>
    public string? Summary { get; set; }

    /// <summary>The user-facing changes in this release, in display order.</summary>
    public List<WhatsNewItemResponse> Items { get; set; } = [];
}

/// <summary>
/// A single user-facing change within a release.
/// </summary>
public class WhatsNewItemResponse
{
    /// <summary>One of "added", "changed", or "fixed". Displayed as New / Improved / Fixed.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>What the user can now do, written for originators rather than engineers.</summary>
    public string Text { get; set; } = string.Empty;

    /// <summary>
    /// Optional heading this item sits under, so one release can present several features
    /// separately instead of as one flat list. A release is one deploy, which is what the
    /// client's seen/unseen check keys on — the group is only ever a presentation detail
    /// within it.
    /// <para>
    /// Items are grouped in file order by consecutive runs of the same value, so the author
    /// controls the order and nothing is silently rearranged. Null or absent means the item
    /// renders with no heading.
    /// </para>
    /// </summary>
    public string? Group { get; set; }
}
