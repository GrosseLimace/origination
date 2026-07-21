namespace GrainOriginatorPortal.Api.Models;

/// <summary>
/// Lookup data for the note "@" mention picker, scoped to the calling user's trade-unit
/// access (resolved from dbo.vw_UserTradeUnitAccess in the Entitlements DB). The three lists
/// map to the three <see cref="NoteMention"/> types a user can mention.
/// </summary>
public class MentionCatalogResponse
{
    public List<MentionCatalogPerson> People { get; set; } = [];
    public List<MentionCatalogTradeUnit> TradeUnits { get; set; } = [];
    public List<MentionCatalogGroup> Groups { get; set; } = [];
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
