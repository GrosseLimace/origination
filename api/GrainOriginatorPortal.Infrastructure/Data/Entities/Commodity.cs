namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Lookup table for commodity codes and their human-readable names.
/// Seeded from ODS contract data (CommodityCode + CommodityDescription).
/// Code matches Contract.CommodityCode and Ticket.ProductCode.
/// </summary>
public class Commodity
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Tier1 { get; set; }
    public string? Tier2 { get; set; }
    public string? Tier3 { get; set; }
    public string? BaseUOM { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>When true, this commodity appears in the curated Planting Intentions crop
    /// dropdown. Defaults false; only an approved short list is flagged. The additive-only
    /// commodity sync never resets it, so new auto-synced commodities stay hidden there.</summary>
    public bool ShowInPlantingIntentions { get; set; }

    /// <summary>Restricts a curated commodity to one trade group. Null (the default, and every row
    /// today bar the organics) means every user sees it. A value is matched as a case-insensitive
    /// SUBSTRING of the group names from vw_UserTradeUnitPreferences, so "Organics" matches the
    /// group "Organics &amp; IP" and survives an upstream rename. One scope per row; if a commodity
    /// ever needs two, this becomes a join table. Like ShowInPlantingIntentions, the additive-only
    /// commodity sync never writes it.</summary>
    public string? TradeGroupScope { get; set; }

    /// <summary>Restricts a curated commodity to specific trade units — a comma-separated code list
    /// (e.g. "2090,2291,2295"). Null (the default) means no unit restriction. Needed because a trade
    /// GROUP is too coarse: these three are only half of Organics &amp; IP, and TradeGroupScope cannot
    /// express a subset of a group.
    ///
    /// Matched by EXACT membership after splitting, never as a substring — unlike TradeGroupScope.
    /// Substring matching on numeric codes is actively wrong: "209" would match 2090, 2093 and 2094.
    ///
    /// Combined with TradeGroupScope by OR, so a row shows when it is unscoped, or its group matches,
    /// or one of its units is in scope. Like the other two flags, the commodity sync never writes it.</summary>
    public string? TradeUnitScope { get; set; }
}
