namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Prepares a producer-code set for a <c>customerIds</c> filter.
/// </summary>
/// <remarks>
/// Shared by the contract and ticket readers so the length limit below lives in exactly one place. It is
/// a measured value, not a convention, and having two copies drift would reintroduce a failure whose
/// symptom is an entire chunk of producers going missing.
/// </remarks>
public static class CtrmCustomerCodes
{
    /// <summary>
    /// Longest customer code the <c>customerIds</c> filter tolerates.
    /// </summary>
    /// <remarks>
    /// Found by bisection against live QA: 7 characters returns data, 8 returns
    /// <c>"An internal error occurred"</c> — and it fails the WHOLE request, so one malformed code in a
    /// chunk takes down every producer sharing it. Real ScoularIds are 5-7 characters, so this only ever
    /// trips on bad data; the blast radius is what makes filtering better than trusting. Reported
    /// upstream — remove this once the API answers an empty match instead of an error.
    /// </remarks>
    public const int MaxLength = 7;

    /// <summary>Server-enforced ceiling on the number of entries in one <c>customerIds</c> list.</summary>
    public const int MaxPerCall = 500;

    /// <summary>
    /// Trims, de-duplicates and sorts a code set, dropping anything the filter cannot accept.
    /// </summary>
    /// <param name="codes">Raw codes, typically <c>Customer.ScoularId</c> values.</param>
    /// <param name="dropped">Codes removed for being too long, so the caller can log them.</param>
    /// <remarks>
    /// Sorted so a caller can derive an order-independent cache key from the result.
    /// </remarks>
    public static List<string> Normalize(IReadOnlyCollection<string>? codes, out List<string> dropped)
    {
        var cleaned = (codes ?? [])
            .Select(c => c?.Trim())
            .Where(c => !string.IsNullOrEmpty(c))
            .Select(c => c!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        dropped = [.. cleaned.Where(c => c.Length > MaxLength)];

        return dropped.Count == 0
            ? cleaned
            : [.. cleaned.Where(c => c.Length <= MaxLength)];
    }
}
