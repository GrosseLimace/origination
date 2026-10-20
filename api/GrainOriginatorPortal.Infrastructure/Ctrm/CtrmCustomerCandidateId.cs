using System.Globalization;

namespace GrainOriginatorPortal.Infrastructure.Ctrm;

/// <summary>
/// Placeholder ids for producers the onboarding search found in CTRM that are not yet in <c>dbo.Customer</c>
/// (plan E3/E4).
/// </summary>
/// <remarks>
/// <para>On the ODS path a search candidate carries its ODS surrogate id, which is also the id it is inserted
/// under. CTRM has no such id: a producer gets one only when onboarding mints it from
/// <c>dbo.CustomerIdSequence</c>. The client still needs every candidate to have a distinct, stable id - the
/// list keys rows, selection and the details cache on it - so a candidate gets a NEGATIVE id derived from its
/// source code: negative because no real customer id is (ODS ids and minted ids are positive), derived so the
/// same producer gets the same placeholder from one search to the next, and within the JavaScript safe-integer
/// range so it survives the JSON round trip intact.</para>
///
/// <para>The plan (E3) said "Id = 0". Every candidate at 0 collides in the client list and selection, so this
/// is the deviation recorded in the implementation notes. A placeholder is never written: onboarding sends the
/// <c>ScoularId</c> alongside it (E4), the server mints the real id, and the client follows the returned id
/// exactly as it already does for an adopted row.</para>
/// </remarks>
public static class CtrmCustomerCandidateId
{
    /// <summary>Lowest magnitude a placeholder can have; [-Floor - Span, -Floor].</summary>
    public const long Floor = 1_000_000_000_000_000;

    /// <summary>Width of the placeholder band. Floor + Span = 9e15, inside the 2^53 JavaScript safe range.</summary>
    public const long Span = 8_000_000_000_000_000;

    /// <summary>The placeholder for a source code: FNV-1a over the trimmed, upper-cased code, folded into the band.</summary>
    public static long From(string sourceCode)
    {
        var code = (sourceCode ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length == 0) throw new ArgumentException("A source code is required.", nameof(sourceCode));

        var hash = 14695981039346656037UL;
        foreach (var c in code)
        {
            hash ^= c;
            hash *= 1099511628211UL;
        }

        var offset = (long)(hash % (ulong)Span);
        return -(Floor + offset);
    }

    /// <summary>True for a placeholder (any negative id). Zero and positive ids are real.</summary>
    public static bool IsCandidate(long id) => id < 0;

    /// <summary>For log lines: the id as text, never the code it was derived from.</summary>
    public static string Describe(long id) => id.ToString(CultureInfo.InvariantCulture);
}
