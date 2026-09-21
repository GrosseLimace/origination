namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// Normalisation for raw ODS customer values that carry sentinel data the app should not.
/// Applied on the way in (sync insert, sync update, onboarding read) so no caller downstream
/// has to remember the quirk.
/// </summary>
public static class OdsValues
{
    /// <summary>
    /// Returns null for a NOPID that isn't one. base.Customer.NopIdNumber holds the literal "0"
    /// as a placeholder on roughly 1,525 rows in ODS — far more than hold a real id — so treating
    /// "present" as "has a NOPID" overstates the certified population by about 3x. Real values
    /// are 10 digits. Blank and "0" both mean "none".
    /// </summary>
    public static string? NormaliseNopId(string? raw)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed == "0" ? null : trimmed;
    }
}
