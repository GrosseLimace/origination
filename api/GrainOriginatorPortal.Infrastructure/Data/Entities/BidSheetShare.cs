namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One share on a bid sheet: a person, a whole trade unit, a trade-unit group, or a Daily Recap group.
/// Everyone a share resolves to gets full edit rights — there is no view-only tier.
/// </summary>
/// <remarks>
/// This started people-only, on the argument that naming a person keeps a sheet's membership from
/// changing when somebody's desk assignment does. In practice that made sharing with a desk a chore of
/// adding its members one by one, and left the list stale the moment somebody moved. It now copies
/// <see cref="DailyRecapGroupMember"/>'s discriminator taxonomy verbatim (person / trade-unit /
/// trade-unit-group, plus recap-group here), and membership is re-resolved on every read — so a new
/// hire on desk 2190 can open the sheet without anyone editing it.
///
/// The trade-off is deliberate and worth knowing: a desk share means the audience DOES move with
/// entitlements. Naming a person is still available, and is still the way to pin one specific human.
/// </remarks>
public class BidSheetShare
{
    public int Id { get; set; }

    public int BidSheetId { get; set; }

    /// <summary>
    /// What <see cref="MemberId"/> refers to: <c>person</c>, <c>trade-unit</c>, <c>trade-unit-group</c>
    /// or <c>recap-group</c>. Same string values DailyRecapGroupMember uses for the first three, so the
    /// two features cannot drift apart in the database.
    /// </summary>
    public string MemberType { get; set; } = BidSheetShareTypes.Person;

    /// <summary>
    /// The id, whose meaning depends on <see cref="MemberType"/>: a short UPN ("CEgr") for a person,
    /// a trade-unit code ("2190"), an entitlements trade-unit-group id, or a DailyRecapGroup id.
    /// Stored as a string for all four so one column can carry every kind.
    /// </summary>
    public string MemberId { get; set; } = string.Empty;

    /// <summary>Display name captured when shared, so the list reads without a directory round trip.</summary>
    public string? MemberName { get; set; }

    public string SharedBy { get; set; } = string.Empty;
    public DateTime SharedAt { get; set; }

    public BidSheet? BidSheet { get; set; }
}

/// <summary>
/// The four things a bid sheet can be shared with. Constants rather than an enum because they are
/// persisted as strings and compared inside EF predicates, and because the first three must stay
/// byte-identical to the values DailyRecapGroupMember already writes.
/// </summary>
public static class BidSheetShareTypes
{
    public const string Person = "person";
    public const string TradeUnit = "trade-unit";
    public const string TradeUnitGroup = "trade-unit-group";

    /// <summary>A Daily Recap group ("Manage Groups"). Membership there is itself people/units/groups,
    /// so resolving this one is a second hop — see the bid sheet repository's visibility predicate.</summary>
    public const string RecapGroup = "recap-group";

    public static bool IsKnown(string? type) =>
        type is Person or TradeUnit or TradeUnitGroup or RecapGroup;
}
