namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// How recently the certifier touched a producer's profile, and whether that is recent enough for
/// the organics desk.
///
/// ── Why this measures what it measures ──
/// Scoular's certifier requires documentation issued within the last 18 months in order to trade
/// (Kate Hoegermeyer). There is no certificate issue date in any queryable form — not in the feed,
/// not in Profisee, not behind the USDA Organic Integrity site; it exists only on the printed PDF.
///
/// So the desk chose the next best thing (Madeline Tatum, 2026-10-01): the **"updated on" date**
/// shown at the top of the INTEGRITY operation profile, which arrives in the feed as
/// <c>lastUpdatedDate</c>.
///
/// ⚠️ Be precise about what that is. It records that the PROFILE was modified — which could be a
/// name change, an address, an added item — NOT that a certificate was issued. It is a proxy, and
/// a reasonable one: certifiers have been mandated since March 2024 to keep INTEGRITY current, so a
/// profile untouched for 18 months says something real. But nothing here should be labelled
/// "certificate issued", because it is not.
///
/// Note also that this and the anniversary date can disagree. Both captured samples are inside the
/// 18-month window on this measure while already PAST their next scheduled annual update. This
/// measure is the more permissive of the two.
/// </summary>
public static class OrganicRecordCurrency
{
    /// <summary>The desk's standing requirement. Overridable via
    /// <c>OrganicCertification:ComplianceWindowMonths</c>.</summary>
    public const int DefaultComplianceWindowMonths = 18;

    /// <summary>
    /// Whole months between the certifier's last profile update and <paramref name="asOf"/>.
    /// Null when there is no date, so callers can say "unknown" rather than imply zero.
    /// </summary>
    public static int? MonthsSinceUpdate(DateTime? sourceUpdatedOn, DateTime asOf)
    {
        if (sourceUpdatedOn is null) return null;

        var updated = sourceUpdatedOn.Value.Date;
        var today = asOf.Date;
        if (updated > today) return 0;   // a future stamp is not stale; treat it as current

        var months = ((today.Year - updated.Year) * 12) + today.Month - updated.Month;
        if (today.Day < updated.Day) months--;   // not a whole month yet

        return months < 0 ? 0 : months;
    }

    /// <summary>
    /// Whether this record falls outside the desk's compliance window.
    ///
    /// A MISSING date counts as outside it. We cannot show a trader "current" on the strength of a
    /// date we do not have, and failing safe is the right direction for a compliance signal.
    /// </summary>
    public static bool IsOutsideWindow(
        DateTime? sourceUpdatedOn,
        DateTime asOf,
        int windowMonths = DefaultComplianceWindowMonths)
    {
        var months = MonthsSinceUpdate(sourceUpdatedOn, asOf);
        return months is null || months > windowMonths;
    }
}
