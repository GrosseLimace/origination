namespace GrainOriginatorPortal.Infrastructure.Abstractions;

/// <summary>
/// Turns what an originator typed into the "Add from BarChart" search box into the terms the catalog
/// query matches on.
///
/// Kept separate from the query itself so the interesting part -- how a phrase becomes terms, and what
/// counts as a state -- is testable without a database. The repository just walks the result.
/// </summary>
public static class BarchartLocationSearch
{
    /// <summary>
    /// How many words are honoured. Each one adds a set of LIKE predicates, so this bounds the SQL a
    /// long paste can produce. Six is well past anything a real search needs -- "alliance ag grain
    /// belpre kansas" is five -- and the extra words are dropped rather than failing the search.
    /// </summary>
    public const int MaxTerms = 6;

    /// <summary>
    /// One word from the search box, and the state it names if it names one.
    /// </summary>
    /// <param name="Text">The word as typed, trimmed.</param>
    /// <param name="StateCode">
    /// The two-letter code when the word is a state ("kansas" and "ks" both give "KS"), else null. The
    /// catalog only stores codes, so without this a search for "kansas" matched nothing at all.
    /// </param>
    public readonly record struct SearchTerm(string Text, string? StateCode);

    /// <summary>
    /// Splits the search into words, in order, without duplicates.
    ///
    /// Words rather than one phrase because an originator names a site by combining things that live in
    /// different columns: "alliance belpre" is the company plus the town, "belpre ks" the town plus the
    /// state. A single Contains over a single field can only match text that sits together in one
    /// column, so both of those found nothing. Every word has to match SOMETHING (the caller ANDs
    /// them), but not the same something.
    ///
    /// Commas and slashes are separators too, so "Belpre, KS" pasted from anywhere behaves the same as
    /// typing it.
    ///
    /// The one place two words stay together is a state whose name IS two words: splitting "north
    /// dakota" would leave neither half naming a state, so it would quietly become a text search for
    /// sites with "north" and "dakota" in their names. Ten states are like this.
    /// </summary>
    public static IReadOnlyList<SearchTerm> ParseTerms(string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return [];

        var words = search
            .Replace(',', ' ')
            .Replace('/', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var terms = new List<SearchTerm>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < words.Length && terms.Count < MaxTerms; i++)
        {
            var text = words[i];
            var code = StateCode(text);

            // Look ahead before settling for the single word: "new" and "york" mean nothing apart.
            if (i + 1 < words.Length)
            {
                var pair = $"{text} {words[i + 1]}";
                var pairCode = StateCode(pair);
                if (pairCode != null)
                {
                    text = pair;
                    code = pairCode;
                    i++;
                }
            }

            if (seen.Add(text)) terms.Add(new SearchTerm(text, code));
        }

        return terms;
    }

    /// <summary>
    /// The two-letter code for a state name or code, or null when the word is not a state.
    /// </summary>
    /// <remarks>
    /// A two-letter word is only treated as a state when it IS one, so "ag" stays a plain word. The
    /// caller ORs this with the text matches, so a word that happens to be both -- there is no such
    /// case today, but "Ohio" as a town name would be -- still matches either way.
    /// </remarks>
    public static string? StateCode(string? word)
    {
        if (string.IsNullOrWhiteSpace(word)) return null;
        var key = word.Trim();
        return ByName.TryGetValue(key, out var code) ? code : null;
    }

    // Names and codes together in one lookup, so "kansas", "Kansas" and "KS" all resolve without the
    // caller knowing which form it has. Ordinal-ignore-case: these are fixed ASCII strings, and a
    // culture-aware comparison here would only add surprises.
    private static readonly Dictionary<string, string> ByName = BuildLookup();

    private static Dictionary<string, string> BuildLookup()
    {
        var states = new (string Code, string Name)[]
        {
            ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"),
            ("CA", "California"), ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"),
            ("DC", "District of Columbia"), ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"),
            ("ID", "Idaho"), ("IL", "Illinois"), ("IN", "Indiana"), ("IA", "Iowa"),
            ("KS", "Kansas"), ("KY", "Kentucky"), ("LA", "Louisiana"), ("ME", "Maine"),
            ("MD", "Maryland"), ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"),
            ("MS", "Mississippi"), ("MO", "Missouri"), ("MT", "Montana"), ("NE", "Nebraska"),
            ("NV", "Nevada"), ("NH", "New Hampshire"), ("NJ", "New Jersey"), ("NM", "New Mexico"),
            ("NY", "New York"), ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"),
            ("OK", "Oklahoma"), ("OR", "Oregon"), ("PA", "Pennsylvania"), ("RI", "Rhode Island"),
            ("SC", "South Carolina"), ("SD", "South Dakota"), ("TN", "Tennessee"), ("TX", "Texas"),
            ("UT", "Utah"), ("VT", "Vermont"), ("VA", "Virginia"), ("WA", "Washington"),
            ("WV", "West Virginia"), ("WI", "Wisconsin"), ("WY", "Wyoming"),
        };

        var lookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (code, name) in states)
        {
            lookup[code] = code;
            lookup[name] = code;
        }
        return lookup;
    }
}
