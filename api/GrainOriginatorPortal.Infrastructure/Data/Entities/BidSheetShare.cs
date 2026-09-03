namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One person a bid sheet is shared with. They get full edit rights on it.
///
/// Deliberately people-only, unlike DailyRecapGroupMember's person / trade-unit / trade-unit-group
/// taxonomy. That discriminator earns its keep there because an external Logic App re-resolves
/// recipients at send time, so "everyone on desk 2190" has to stay live. A bid sheet is opened by a
/// person, and naming them directly means the sheet's membership does not silently change when
/// somebody's desk assignment does.
/// </summary>
public class BidSheetShare
{
    public int Id { get; set; }

    public int BidSheetId { get; set; }

    /// <summary>Short UPN ("CEgr"), the same form as <see cref="BidSheet.OwnerUserId"/>.</summary>
    public string MemberUserId { get; set; } = string.Empty;

    /// <summary>Display name captured when shared, so the list reads without a directory round trip.</summary>
    public string? MemberName { get; set; }

    public string SharedBy { get; set; } = string.Empty;
    public DateTime SharedAt { get; set; }

    public BidSheet? BidSheet { get; set; }
}
