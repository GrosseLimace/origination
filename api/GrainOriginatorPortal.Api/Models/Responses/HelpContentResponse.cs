namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// The self-help content from Content/help-faq.json: every question, the categories the Help page
/// groups them under, and the questions suggested on each screen. Served whole — the file is small,
/// and the client matches typed questions against it locally.
/// </summary>
public class HelpContentResponse
{
    /// <summary>The Help page's category tiles, in display order.</summary>
    public List<HelpCategoryResponse> Categories { get; set; } = [];

    /// <summary>
    /// Question ids suggested when the panel opens, keyed by app route ("/", "/build-list", …).
    /// The "*" key is the fallback for any route without its own list.
    /// </summary>
    public Dictionary<string, List<string>> Suggestions { get; set; } = [];

    /// <summary>Every question, in no particular order. Categories and suggestions refer to them by id.</summary>
    public List<HelpFaqResponse> Faqs { get; set; } = [];
}

/// <summary>One category tile on the Help page.</summary>
public class HelpCategoryResponse
{
    /// <summary>Stable slug, e.g. "trade-units".</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Tile label, e.g. "Trade units".</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Icon key the client maps to an inline SVG.</summary>
    public string Icon { get; set; } = string.Empty;

    /// <summary>The questions under this category, in display order.</summary>
    public List<string> FaqIds { get; set; } = [];
}

/// <summary>
/// One question and its layered answer. Every block after <see cref="Answer"/> is optional; the
/// client renders whichever ones are present, in a fixed order.
/// <para>
/// Answer text is plain text with one convention: <c>**double asterisks**</c> mark a bold span (an
/// on-screen label). The client splits on the markers and binds each piece as text — it is never
/// parsed as markdown or HTML. Links are never written into text; they are <see cref="Actions"/>.
/// </para>
/// </summary>
public class HelpFaqResponse
{
    /// <summary>Stable slug. Used in deep links (/help#id), usage events and cross-references.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>The full question, shown as the answer card's title.</summary>
    public string Question { get; set; } = string.Empty;

    /// <summary>Optional short form for suggestion chips. Falls back to <see cref="Question"/>.</summary>
    public string? Chip { get; set; }

    /// <summary>Extra words the matcher should treat as hits — synonyms users actually type.</summary>
    public List<string> Keywords { get; set; } = [];

    /// <summary>App routes this question is about. Boosts it on those screens.</summary>
    public List<string> Routes { get; set; } = [];

    /// <summary>Feature code, matching the usage-tracking feature codes ("customers", "build-a-list", …).</summary>
    public string Feature { get; set; } = string.Empty;

    /// <summary>The quick answer. Always shown.</summary>
    public string Answer { get; set; } = string.Empty;

    /// <summary>Optional numbered steps, behind "Show steps".</summary>
    public List<string>? Steps { get; set; }

    /// <summary>True when the steps should start expanded.</summary>
    public bool StepsOpen { get; set; }

    /// <summary>Optional buttons under the quick answer. The first renders filled, the rest outlined.</summary>
    public List<HelpActionResponse>? Actions { get; set; }

    /// <summary>Optional single in-app link shown after the steps ("Go to Build a List →").</summary>
    public HelpActionResponse? Link { get; set; }

    /// <summary>Optional Build a List example queries, by Query Library name.</summary>
    public List<string>? Examples { get; set; }

    /// <summary>Optional "Troubleshoot this" entries: another question, or an interactive check.</summary>
    public List<HelpTroubleshootResponse>? Troubleshoot { get; set; }

    /// <summary>True to show the "Still need help?" escalation link.</summary>
    public bool Escalate { get; set; }

    /// <summary>Related question ids, shown as chips under the card.</summary>
    public List<string> Related { get; set; } = [];

    /// <summary>
    /// The exact on-screen labels this answer names. A client test fails the build when one stops
    /// appearing in the app, so a renamed button can't leave the help describing it by its old name.
    /// </summary>
    public List<string> UiLabels { get; set; } = [];

    /// <summary>When someone last checked this answer against the app.</summary>
    public DateOnly LastVerified { get; set; }
}

/// <summary>
/// A button or link inside an answer. Never a free-form URL: <see cref="Kind"/> picks one of a fixed
/// set of in-app behaviours and <see cref="Target"/> is interpreted by that behaviour.
/// </summary>
public class HelpActionResponse
{
    /// <summary>
    /// One of: "route" (navigate to an app route), "spotlight" (outline an on-screen control by its
    /// data-help-anchor), "tup" (open Trade Unit Preferences), "producer-tab" (open a tab on the
    /// selected producer), "help" (open the full Help page).
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Button text.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Route, anchor name or tab id, depending on <see cref="Kind"/>. Unused by "tup" and "help".</summary>
    public string? Target { get; set; }
}

/// <summary>One "Troubleshoot this" entry. Exactly one of the two targets is set.</summary>
public class HelpTroubleshootResponse
{
    /// <summary>Entry text.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Opens another question's answer.</summary>
    public string? FaqId { get; set; }

    /// <summary>Starts an interactive troubleshooter, e.g. "missing-producer".</summary>
    public string? Tree { get; set; }
}
