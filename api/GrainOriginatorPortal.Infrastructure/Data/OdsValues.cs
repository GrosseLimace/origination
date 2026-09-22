namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Normalisation for raw ODS customer values that carry sentinel data the app should not.
/// Applied on the way in (sync insert, sync update, onboarding read) so no caller downstream
/// has to remember the quirk.
/// </summary>
public static class OdsValues
{
    /// <summary>Length of a real NOP operation id.</summary>
    private const int NopIdLength = 10;

    /// <summary>
    /// Returns the NOPID when it is a real one, otherwise null. base.Customer.NopIdNumber cannot be
    /// tested for non-empty: measured against Dev ODS on 2026-09-21, of the rows carrying a value,
    /// 1,525 held the single character "0" and one held "999999999"; only 784 held a real 10-digit
    /// id. Treating non-empty as present would fire the organic badge on roughly four times the
    /// correct population — and because the id is rendered on the producer profile, would put
    /// "NOP ID 0" on screen.
    ///
    /// The rule is therefore positive rather than exclusionary: a value counts only when it is
    /// exactly ten digits. Anything else — blank, "0", "999999999", or a shape we have not seen —
    /// means "none". Normalising here, on ingest, keeps dbo.Customer free of placeholders so no
    /// future consumer of the column has to re-learn this.
    /// </summary>
    public static string? NormaliseNopId(string? raw)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        if (trimmed.Length != NopIdLength) return null;

        foreach (var ch in trimmed)
        {
            if (!char.IsAsciiDigit(ch)) return null;
        }

        return trimmed;
    }
}
