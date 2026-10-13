using System.Text;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Turns a certification item into the list of crops to show a trader.
///
/// Certified items arrive in two shapes. Catalogued ones carry a clean <c>itemName</c> from USDA's
/// catalogue ("Soybeans") and need no work. Free-text ones carry nothing but a certifier-written
/// string in <c>otherItems</c>, and whole operations arrive that way — so this is the normal path,
/// not an edge case.
///
/// The free-text strings are written by humans at the certifying agency with no agreed format:
/// <code>
///   "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa"
///   "Milk, Dairy Cows (all eligible for organic slaughter), Dairy Replacements (...)"
///   "Carryover Crops of: 2024 Soybeans - 4000 bushels and 2024 Corn - 5000 bushels"
/// </code>
///
/// Splitting is deliberate, per the organics desk: "Oats/Alfalfa" means the producer may sell both
/// oats and alfalfa, so a trader searching for oats must find them.
///
/// Two rules keep that from mangling the harder strings:
/// <list type="bullet">
/// <item><b>Never split inside brackets.</b> "Dairy Cows (all eligible for organic slaughter)" is
/// one entry; a comma appearing inside the brackets must not break it in half.</item>
/// <item><b>Duplicates collapse.</b> Splitting the first example yields Alfalfa three times, once
/// alone and twice as half of a pairing. A trader wants one chip per crop.</item>
/// <item><b>A leading "and" / "or" is dropped.</b> Certifiers write prose lists — "Corn, Soybeans,
/// and Wheat" — which would otherwise produce a chip reading "and Wheat". See
/// <see cref="StripLeadingConjunction"/>.</item>
/// </list>
///
/// This is deliberately NOT clever. It does not try to recognise crop names, strip quantities or
/// parse prose — anything it cannot split sensibly comes back as a single entry, which displays as
/// the certifier wrote it. That is the honest failure: an odd-looking chip, never a missing crop.
/// </summary>
public static class OrganicCertifiedCrops
{
    /// <summary>
    /// Separators the desk considers list punctuation. The hyphen is the riskiest of these — it
    /// appears inside quantities ("2024 Soybeans - 4000 bushels") as well as between crops — so if
    /// prose entries start reading badly, it is the first one to reconsider.
    /// </summary>
    private static readonly char[] Separators = [',', ';', '/', '&', '-', '+'];

    /// <summary>Opening and closing brackets inside which separators are ignored.</summary>
    private const string Openers = "([{";
    private const string Closers = ")]}";

    /// <summary>
    /// The crops to display for one item. Prefers the catalogued name when there is one, and falls
    /// back to splitting the certifier's free text.
    /// </summary>
    public static IReadOnlyList<string> ForItem(string? itemName, string? otherItems)
    {
        if (!string.IsNullOrWhiteSpace(itemName)) return [itemName.Trim()];
        return Split(otherItems);
    }

    /// <summary>
    /// Splits a certifier's free-text list into individual crops, ignoring separators inside
    /// brackets and collapsing duplicates. Returns empty for null or whitespace.
    /// </summary>
    public static IReadOnlyList<string> Split(string? freeText)
    {
        if (string.IsNullOrWhiteSpace(freeText)) return [];

        var parts = new List<string>();
        var current = new StringBuilder();
        var depth = 0;

        foreach (var ch in freeText)
        {
            if (Openers.Contains(ch)) depth++;
            else if (Closers.Contains(ch) && depth > 0) depth--;

            // Inside brackets, separators are part of the text rather than between entries.
            if (depth == 0 && Separators.Contains(ch))
            {
                parts.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(ch);
        }

        parts.Add(current.ToString());

        // Case-insensitive de-duplication that keeps first-seen casing and source order: splitting
        // "Oats/Alfalfa ... Wheat/Alfalfa" yields Alfalfa repeatedly, and a trader wants one chip.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var crops = new List<string>();

        foreach (var part in parts)
        {
            var trimmed = StripLeadingConjunction(part.Trim());
            if (trimmed.Length == 0) continue;
            if (seen.Add(trimmed)) crops.Add(trimmed);
        }

        return crops;
    }

    /// <summary>
    /// Removes a leading "and " or "or " from a split piece.
    ///
    /// Certifiers write prose lists, not data: the first real message from the pipeline carried
    /// "Corn, Soybeans, and Wheat" (LEHMMAD, Dev dark run 2026-10-12), which split into a chip
    /// reading <i>"and Wheat"</i>. Both samples we had been testing against used bare comma lists,
    /// so it took live certifier wording to surface this.
    ///
    /// ⚠️ The trailing space in the comparison is load-bearing, not punctuation. Matching the bare
    /// prefix would eat the start of real crops — "Andean" would become "ean", "Orchardgrass" would
    /// become "chardgrass". Only a whole leading word followed by whitespace is removed.
    ///
    /// Repeats, so "and/or Wheat" — which the "/" separator already breaks into "and" and
    /// "or Wheat" — ends up as an empty piece (dropped) and "Wheat". A piece that is nothing BUT a
    /// conjunction collapses to empty and is dropped by the caller, which is the right answer: it
    /// was never a crop.
    ///
    /// Deliberately only "and" and "or". This stays a punctuation fixer, not a prose parser — the
    /// class's honest failure mode is an odd-looking chip, never a missing crop.
    /// </summary>
    private static string StripLeadingConjunction(string piece)
    {
        var result = piece;

        while (true)
        {
            var before = result;

            foreach (var conjunction in Conjunctions)
            {
                if (result.Length > conjunction.Length
                    && result.StartsWith(conjunction, StringComparison.OrdinalIgnoreCase)
                    && char.IsWhiteSpace(result[conjunction.Length]))
                {
                    result = result[(conjunction.Length + 1)..].TrimStart();
                    break;
                }

                // The piece is the conjunction and nothing else — "Corn, and, Wheat" produces one.
                if (result.Equals(conjunction, StringComparison.OrdinalIgnoreCase))
                {
                    return string.Empty;
                }
            }

            if (ReferenceEquals(before, result) || before == result) return result;
        }
    }

    private static readonly string[] Conjunctions = ["and", "or"];
}
