namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Lookup data for the note "@" mention picker. The four lists map to the four
/// <see cref="NoteMention"/> types a user can mention. The first three are scoped to the caller's
/// trade-unit access (dbo.vw_UserTradeUnitPreferences, TradeUnitPreferences DB); <see cref="AppGroups"/> comes
/// from the Origination DB instead, so the two are gathered independently — an outage of one
/// source must not empty the other.
/// </summary>
public class MentionCatalogResponse
{
    /// <summary>
    /// True when at least one of the sources below could not be read, so one or more lists are empty
    /// because of an outage rather than because there is nothing to offer. The picker still opens
    /// with whatever was gathered; this is how it tells the user something is missing.
    /// </summary>
    public bool Degraded { get; set; }

    public List<MentionCatalogPerson> People { get; set; } = [];
    public List<MentionCatalogTradeUnit> TradeUnits { get; set; } = [];
    public List<MentionCatalogGroup> TradeUnitGroups { get; set; } = [];
    public List<MentionCatalogAppGroup> AppGroups { get; set; } = [];

    /// <summary>Registered Microsoft Teams channels. Unlike every other list here this one is NOT
    /// scoped to the caller: a channel registered by anyone is mentionable by everyone, which is
    /// what lets the first person to pick a channel make it available to the whole team. Scoping
    /// happens earlier — the composer only ever offers channels the signed-in user belongs to.</summary>
    public List<MentionCatalogTeamsChannel> TeamsChannels { get; set; } = [];
}

/// <summary>A registered Teams channel. Mentioning it posts the note to that channel.</summary>
public class MentionCatalogTeamsChannel
{
    /// <summary>dbo.TeamsChannels key — what a mention stores. Never the channel address.</summary>
    public int ChannelDbId { get; set; }
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Owning team, shown as the secondary label so two channels named "General" are
    /// tellable apart.</summary>
    public string TeamName { get; set; } = string.Empty;

    /// <summary>Graph channel id, so the composer can tell which of the channels it just read from
    /// Graph are already registered.</summary>
    public string ChannelId { get; set; } = string.Empty;
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

    /// <summary>True when this group delivers to a Teams channel, so mentioning it posts the note
    /// there instead of emailing the members. Derived from the group's delivery method, not stored.
    /// The picker labels these by destination rather than a member count, and such an entry may have
    /// zero members — so it is listed on this flag alone.</summary>
    public bool PostsToChannel { get; set; }
}
