namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Lookup data for the note "@" mention picker. People / trade units / trade-unit groups are
/// scoped to the caller's trade-unit access (from dbo.vw_UserTradeUnitAccess in the Entitlements
/// DB); recap groups are the caller's own saved Daily Recap groups. The lists map to the
/// <see cref="NoteMention"/> types a user can mention.
/// </summary>
public class MentionCatalogResponse
{
    public List<MentionCatalogPerson> People { get; set; } = [];
    public List<MentionCatalogTradeUnit> TradeUnits { get; set; } = [];
    public List<MentionCatalogGroup> Groups { get; set; } = [];
    public List<MentionCatalogRecapGroup> RecapGroups { get; set; } = [];
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

/// <summary>A trade-unit group the caller belongs to.</summary>
public class MentionCatalogGroup
{
    public int GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
}

/// <summary>A saved Daily Recap group the caller owns — mentionable so a note can target it.</summary>
public class MentionCatalogRecapGroup
{
    public int RecapGroupId { get; set; }
    public string Name { get; set; } = string.Empty;
}
