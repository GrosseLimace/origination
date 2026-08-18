namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Lookup data for the note "@" mention picker. The four lists map to the four
/// <see cref="NoteMention"/> types a user can mention. The first three are scoped to the caller's
/// trade-unit access (dbo.vw_UserTradeUnitPreference, Entitlements DB); <see cref="AppGroups"/> comes
/// from the Origination DB instead, so the two are gathered independently — an outage of one
/// source must not empty the other.
/// </summary>
public class MentionCatalogResponse
{
    public List<MentionCatalogPerson> People { get; set; } = [];
    public List<MentionCatalogTradeUnit> TradeUnits { get; set; } = [];
    public List<MentionCatalogGroup> TradeUnitGroups { get; set; } = [];
    public List<MentionCatalogAppGroup> AppGroups { get; set; } = [];
}

/// <summary>A person who shares at least one trade unit with the caller.</summary>
public class MentionCatalogPerson
{
    public string UserId { get; set; } = string.Empty;      // UPN prefix, e.g. "CEgr"
    public string DisplayName { get; set; } = string.Empty; // "Caden Egr"
    public string Email { get; set; } = string.Empty;       // "CEgr@scoular.com"
}

/// <summary>A trade unit the caller belongs to.</summary>
public class MentionCatalogTradeUnit
{
    public string Code { get; set; } = string.Empty;
    public string? Description { get; set; }
}

/// <summary>An IT-managed trade-unit group the caller belongs to (Entitlements).</summary>
public class MentionCatalogGroup
{
    public int GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
}

/// <summary>One of the caller's own groups — created by them, or one they're a member of.
/// Mentioning it shares the note with everyone in it; the API flattens it into its members at
/// save time.</summary>
public class MentionCatalogAppGroup
{
    public int GroupId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Member REFERENCES, not a head count — a trade-unit member counts as one here but
    /// resolves to everyone in that trade unit at send time. Label it "members", never "people".</summary>
    public int MemberCount { get; set; }

    /// <summary>False for a group the caller only sees because they're a member of it.</summary>
    public bool IsOwner { get; set; }
}
