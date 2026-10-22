namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>
/// Everything needed to decide which bid sheets a caller may see AND edit, resolved once per request in
/// the service and handed to the repository. Edit rights equal visibility: if a sheet shows in your
/// list you can edit it (DELETE stays owner-only, enforced separately).
/// </summary>
/// <remarks>
/// Deliberately the same shape as <see cref="RecapGroupAccess"/>, which solves the same problem for
/// Daily Recap groups, plus <see cref="RecapGroupIds"/> — a bid sheet can be shared with a recap group,
/// and recap-group membership is itself people/units/groups, so that second hop has to be resolved
/// before the predicate runs rather than inside it.
///
/// One identity in two forms, on purpose: <paramref name="PersonId"/> is the UPN prefix and matches both
/// <c>BidSheet.OwnerUserId</c> and a <c>person</c> share's <c>MemberId</c>; <paramref name="CallerUpn"/>
/// is the full UPN, kept for audit fields (SharedBy, ModifiedBy) which store that form.
/// </remarks>
/// <param name="CallerUpn">Full UPN of the acting user — the form audit columns store.</param>
/// <param name="PersonId">UPN prefix — matches OwnerUserId and a person share's MemberId.</param>
/// <param name="TradeUnitCodes">Trade-unit codes the caller is entitled to.</param>
/// <param name="GroupIds">Entitlements trade-unit-group ids (as strings) the caller belongs to.</param>
/// <param name="RecapGroupIds">Daily Recap group ids (as strings) the caller can see, i.e. is in.</param>
public sealed record BidSheetAccess(
    string CallerUpn,
    string PersonId,
    IReadOnlyCollection<string> TradeUnitCodes,
    IReadOnlyCollection<string> GroupIds,
    IReadOnlyCollection<string> RecapGroupIds)
{
    /// <summary>
    /// The deny-by-default fallback for when entitlements or recap groups can't be read: no desk, group
    /// or recap membership, so the predicate collapses to "sheets I own, or that name me personally".
    /// </summary>
    /// <remarks>
    /// Failing this way can only ever NARROW access — an owner keeps working, someone who is only in via
    /// their desk is denied — which is why the authorization path degrades to this instead of throwing.
    /// The opposite mistake (assuming entitlement on failure) would hand every sheet to everyone.
    /// </remarks>
    public static BidSheetAccess OwnerAndSelfOnly(string callerUpn, string personId) =>
        new(callerUpn, personId, [], [], []);
}
