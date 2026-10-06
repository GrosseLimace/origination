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
            var trimmed = part.Trim();
            if (trimmed.Length == 0) continue;
            if (seen.Add(trimmed)) crops.Add(trimmed);
        }

        return crops;
    }
}
