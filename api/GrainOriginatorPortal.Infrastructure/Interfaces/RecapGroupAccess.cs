using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Infrastructure.Interfaces;

/// <summary>Everything needed to decide which recap groups a caller may see AND edit, resolved once
/// per request in the service and handed to the repository. Edit rights equal visibility: if a group
/// shows on your Manage Groups page you can edit it (delete stays creator-only, enforced separately).
///
/// The two identity fields are deliberately different keys on the same person: <paramref name="CallerUpn"/>
/// is the full UPN and matches <c>DailyRecapGroup.CreatedBy</c>; <paramref name="PersonId"/> is the UPN
/// prefix and matches a <c>person</c> member's <c>MemberId</c>. The trade-unit / group sets come from
/// the caller's entitlements (TU code, and entitlements GroupId as a string).</summary>
/// <param name="CallerUpn">Full UPN of the acting user — matches CreatedBy.</param>
/// <param name="PersonId">UPN prefix of the acting user — matches a person member's MemberId.</param>
/// <param name="TradeUnitCodes">Trade-unit codes the caller is entitled to.</param>
/// <param name="GroupIds">Entitlements trade-unit-group ids (as strings) the caller belongs to.</param>
public sealed record RecapGroupAccess(
    string CallerUpn,
    string PersonId,
    IReadOnlyCollection<string> TradeUnitCodes,
    IReadOnlyCollection<string> GroupIds)
{
    /// <summary>The deny-by-default fallback used when entitlements can't be read: no membership, so
    /// the visibility predicate collapses to <c>CreatedBy == caller</c>. Failing this way can only
    /// ever NARROW access — a creator keeps working, a member is denied — which is why the
    /// authorization path degrades to this instead of throwing.</summary>
    public static RecapGroupAccess CreatorOnly(string callerUpn, string personId) =>
        new(callerUpn, personId, [], []);
}

/// <summary>The mutable fields of a recap group, bundled so the repository's update doesn't need an
/// eight-parameter signature. Members/CcEmails are the fully validated replacement sets — the
/// repository swaps children wholesale.</summary>
public sealed record RecapGroupValues(
    string Name,
    string DeliveryMethod,
    string? TeamsChannelEmail,
    bool MentionsToChannel,
    List<DailyRecapGroupMember> Members,
    List<DailyRecapGroupCcEmail> CcEmails);
