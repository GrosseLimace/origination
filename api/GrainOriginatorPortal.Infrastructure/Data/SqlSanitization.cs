using System.Text.RegularExpressions;

namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Identifier-CSV sanitizers for safely passing caller-controlled identifier collections into
/// parameterized raw SQL (via STRING_SPLIT). The output contains no quotes, semicolons, or SQL
/// metacharacters, so it is safe to send as a single nvarchar SqlParameter value.
/// DO NOT bypass these when interpolating caller-controlled identifier collections into raw SQL.
/// </summary>
public static class SqlSanitization
{
    /// <summary>
    /// Strips every character except [a-zA-Z0-9-_] from each value, then joins with commas.
    /// Use for TradeUnit codes, ScoularIds, and similar identifier collections.
    /// </summary>
    public static string SanitizeCsv(IEnumerable<string> values) =>
        string.Join(",", values.Select(v => Regex.Replace(v, @"[^a-zA-Z0-9\-_]", "")));

    /// <summary>
    /// Same guarantees as <see cref="SanitizeCsv"/>, but also preserves spaces. CTRM contract
    /// numbers (e.g. "PW 452117") legitimately contain a mid-identifier space; the standard
    /// sanitizer would strip it and the STRING_SPLIT key would never match. Spaces aren't a
    /// SQL-injection risk because the joined CSV is sent as a single parameterized nvarchar.
    /// </summary>
    public static string SanitizeIdentifierCsv(IEnumerable<string> values) =>
        string.Join(",", values.Select(v => Regex.Replace(v, @"[^a-zA-Z0-9\-_ ]", "")));
}
