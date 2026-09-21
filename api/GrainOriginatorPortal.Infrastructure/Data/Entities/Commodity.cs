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
    /// (e.g. "2090,2291,2295", or a single "3811" for the flax grades). Null (the default) means no
    /// unit restriction. Needed because a trade GROUP is too coarse: those three are only half of
    /// Organics &amp; IP, and TradeGroupScope cannot express a subset of a group.
    ///
    /// Matched by EXACT membership after splitting, never as a substring — unlike TradeGroupScope.
    /// Substring matching on numeric codes is actively wrong: "209" would match 2090, 2093 and 2094.
    ///
    /// Combined with TradeGroupScope by OR, so a row shows when it is unscoped, or its group matches,
    /// or one of its units is in scope. Like the other two flags, the commodity sync never writes it.</summary>
    public string? TradeUnitScope { get; set; }

    /// <summary>The crop label the planting-intention surfaces (dashboard, producer table, print
    /// report, Build-A-List coverage prompts) group this commodity under when that should differ from
    /// <see cref="Category"/>. Null (the default, and every row bar the organics) means "use Category".
    ///
    /// Category is the ODS commodity GROUP and is shared app-wide as the crop-group key (Build-A-List
    /// crop chips, NLQ, bid-sheet palette, grain on farm), so it cannot simply be changed to "Organic
    /// Soybeans" for YSBO without re-grouping organics everywhere. This column narrows the change to
    /// planting and holds the MARKET the grain sells into: the organics collapse to "Organic Soybeans" /
    /// "Organic Corn" / "Organic Wheat" (classes collapse the way HRWW and SRWW both group as "Wheat"),
    /// while the IP grades keep their own product name ("Waxy Corn", "Hard Endosperm Corn", "Dehulled
    /// Non-GMO Soybeans", "Dehulled Organic Soybeans"), so their acres, season targets and contract
    /// coverage stop being folded into the conventional crop. Not derived from Tier2/Tier3 because the
    /// tiers are only loaded in Dev and SORO's Tier2 is plain "Sorghum". Hand-curated like the other
    /// three flags (see the AddCommodityPlantingCategory migration for the full list and the rows
    /// deliberately left null); the commodity sync never writes it.</summary>
    public string? PlantingCategory { get; set; }
}
