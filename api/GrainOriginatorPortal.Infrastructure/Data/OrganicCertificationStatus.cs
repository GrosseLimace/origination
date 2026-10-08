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

    /// <summary>
    /// Whether the desk should be looking at this certification at all, change or no change.
    ///
    /// Broader than <see cref="HasUnresolvedStatusChange"/> on purpose, and the difference is the
    /// whole point: that rule requires a change to have been OBSERVED, so a producer whose very
    /// first message already said Surrendered appeared on no list anywhere. The organics desk
    /// confirmed (2026-10-07) that they want those producers too — "any producer with a
    /// non-certified certificate should show up in one of the two categories". Having met someone
    /// already surrendered is not a reason to stay quiet about it.
    ///
    /// Anything that is not Certified counts, not Surrendered alone: Suspended and Revoked are at
    /// least as serious, and an unfamiliar status USDA invents tomorrow should flag rather than
    /// slip through.
    ///
    /// 🔑 The Actionable Insights categories this feeds are titled "Organic Certification CHANGE",
    /// which looks inconsistent with a rule that requires no observed change. It is not. Two facts
    /// make the change a safe inference even when we did not witness it (Bailey Cozart, 2026-10-08):
    /// Scoular only enters contracts with certified producers, and the sender filters out operations
    /// holding no certifications at all — so every producer who reaches us was certified at some
    /// point. A non-certified status therefore always represents a change; we may simply have met
    /// them after it happened. Do not "correct" those titles back.
    ///
    /// Says nothing about contracts. Which of the two Actionable Insight categories a producer
    /// lands in — contracted or uncontracted — is decided by the caller, because only the caller
    /// knows the contract position.
    /// </summary>
    public static bool NeedsAttention(string? currentStatus) =>
        !string.IsNullOrWhiteSpace(currentStatus) && !IsCertified(currentStatus);

    /// <summary>The status that turns the producer's badge red.</summary>
    public const string Surrendered = "Surrendered";

    /// <summary>
    /// The scopes whose surrender turns the badge red.
    ///
    /// Crops is the obvious one. Handling was added on Kate Hoegermeyer's instruction (2026-10-07)
    /// after the first version excluded it: <b>some family operations trade under a handling
    /// certificate rather than a crops one</b>, so treating Handling as irrelevant would have left
    /// exactly those producers looking fine when they are not.
    ///
    /// Livestock is the only scope that does not count. Scoular buys grain — a producer giving up
    /// a livestock certificate does not affect what we can buy from them.
    /// </summary>
    private static readonly string[] BadgeScopes = ["Crops", "Handling"];

    /// <summary>
    /// Whether the badge on the producer profile should render RED rather than green.
    ///
    /// True when the OPERATION-level status is Surrendered, or when any of <see cref="BadgeScopes"/>
    /// is. Red specifically for Surrendered — the existing amber dot covers "changed and not yet
    /// resolved". Amber says look into this; red says we may not be able to trade.
    ///
    /// It clears itself: this reads current status only, so the badge returns to green the moment a
    /// message arrives saying anything else. No separate dismissal, no time window.
    /// </summary>
    /// <param name="operationStatus">The operation-level status.</param>
    /// <param name="scopes">Every scope on the certification, as (name, status) pairs.</param>
    public static bool IsSurrendered(
        string? operationStatus,
        IEnumerable<(string? Scope, string? Status)> scopes)
    {
        if (IsSurrenderedValue(operationStatus)) return true;
        if (scopes is null) return false;

        foreach (var (scope, status) in scopes)
        {
            if (IsSurrenderedValue(status) && CountsTowardBadge(scope)) return true;
        }

        return false;
    }

    private static bool IsSurrenderedValue(string? status) =>
        string.Equals(status?.Trim(), Surrendered, StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether a surrender of this scope should redden the badge. Trimmed and
    /// case-insensitive — the source sends title case but is not reliably consistent.</summary>
    public static bool CountsTowardBadge(string? scope)
    {
        var trimmed = scope?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return false;

        foreach (var candidate in BadgeScopes)
        {
            if (string.Equals(trimmed, candidate, StringComparison.OrdinalIgnoreCase)) return true;
        }

        return false;
    }
}
