namespace GrainOriginatorPortal.Infrastructure.Data;

/// <summary>
/// The certification status rules, in one place because two different surfaces need them and are
/// built in different layers: the producer profile reads per customer, while Actionable Insights
/// computes client-side over bulk preloaded data. Implemented twice, they would drift — and a
/// compliance flag that means one thing on the profile and another on the insights page is worse
/// than not having it.
///
/// Deliberately <c>public static</c> so it is unit-testable without a database, following
/// <c>CustomerRepository.IsAchPaymentMethod</c>.
///
/// Status values are third-party vocabulary from USDA via the certifier, so they are compared as
/// strings rather than parsed into an enum: an unrecognised value must be stored and shown, never
/// rejected. The only value this code needs to recognise is "Certified" — everything else is
/// treated as not-certified, which fails safe. A new terminal status invented by USDA tomorrow
/// would flag rather than silently pass.
/// </summary>
public static class OrganicCertificationStatus
{
    /// <summary>The only status that represents a producer in good standing.</summary>
    public const string Certified = "Certified";

    /// <summary>
    /// Whether the operation currently holds certification. Trimmed and case-insensitive, because
    /// the source is not consistent about either.
    /// </summary>
    public static bool IsCertified(string? status) =>
        string.Equals(status?.Trim(), Certified, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Whether a status change should still be flagged to the desk.
    ///
    /// The rule, confirmed by Madeline Tatum on the organics desk (2026-09-24) and applying to BOTH
    /// the producer profile indicator and the Actionable Insight: **keep the change flagged until
    /// the status is back to Certified.** Not a time window — a producer that went Surrendered six
    /// months ago and has not been reinstated is still something the desk needs to see.
    ///
    /// Two conditions, and both matter:
    /// <list type="bullet">
    /// <item>A change must actually have been observed (<paramref name="previousStatus"/> is set).
    /// A producer whose first-ever message already said Surrendered has not *changed* — we simply
    /// met them that way — so there is nothing to announce.</item>
    /// <item>The current status must not be Certified. Returning to Certified is the resolution
    /// event, so the flag clears itself with no separate dismissal.</item>
    /// </list>
    ///
    /// The Actionable Insight carries one ADDITIONAL exit its own layer must apply: it drops when
    /// the contract closes or is cancelled. That is deliberately not here, because the profile is
    /// not contract-scoped — a producer's certification state is true regardless of whether they
    /// currently have a contract open.
    /// </summary>
    public static bool HasUnresolvedStatusChange(string? currentStatus, string? previousStatus) =>
        !string.IsNullOrWhiteSpace(previousStatus) && !IsCertified(currentStatus);
}
