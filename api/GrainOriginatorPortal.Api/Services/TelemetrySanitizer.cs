using System.Text.RegularExpressions;

namespace GrainOriginatorPortal.Api.Services;

/// <summary>
/// Redacts contact PII from telemetry <c>TargetId</c> values before they are persisted to the
/// usage-tracking store and surfaced in the (admin-only) usage dashboard. Some Build-A-List events
/// send raw free-text (an unmatched library search, a natural-language query request) as the
/// TargetId, and that text can contain producer emails, phone numbers, or other sensitive input.
///
/// Emails and formatted phone numbers are always stripped — numeric/opaque IDs (customerId,
/// contractId, listId, …) contain neither an '@' nor phone separators, so those events are
/// unaffected. Bare long digit runs are only masked for the known free-text events, so a large
/// numeric ID on some other event type is never clobbered.
/// </summary>
public static partial class TelemetrySanitizer
{
    /// <summary>SubFeatureCodes whose TargetId is raw user free-text and may embed PII.</summary>
    private static readonly HashSet<string> FreeTextSubFeatures = new(StringComparer.OrdinalIgnoreCase)
    {
        "library-search-no-match",
        "query-request-submitted",
        "library-search",
        // Unshipped Bushels search boxes — the page runs entirely client-side, so these terms are
        // typed straight into telemetry.
        "search-customer",
        "search-commodity",
        "search-contract",
    };

    [GeneratedRegex(@"[^\s@]+@[^\s@]+\.[^\s@]+", RegexOptions.Compiled)]
    private static partial Regex EmailRegex();

    // Requires a separator/parens between digit groups, so contiguous numeric IDs never match.
    [GeneratedRegex(@"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}", RegexOptions.Compiled)]
    private static partial Regex PhoneRegex();

    // Bare 7+ digit runs (unformatted phone / account numbers). Only applied to free-text fields.
    [GeneratedRegex(@"\d{7,}", RegexOptions.Compiled)]
    private static partial Regex LongDigitsRegex();

    /// <summary>
    /// Returns <paramref name="targetId"/> with contact PII redacted. Search terms remain intact
    /// (only the sensitive tokens are replaced) so query-gap analysis stays useful.
    /// </summary>
    public static string? Redact(string? targetId, string? subFeatureCode)
    {
        if (string.IsNullOrEmpty(targetId)) return targetId;

        var result = EmailRegex().Replace(targetId, "[redacted-email]");
        result = PhoneRegex().Replace(result, "[redacted-phone]");

        if (subFeatureCode is not null && FreeTextSubFeatures.Contains(subFeatureCode))
            result = LongDigitsRegex().Replace(result, "[redacted-number]");

        return result;
    }
}
