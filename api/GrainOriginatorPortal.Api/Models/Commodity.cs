namespace GrainOriginatorPortal.Api.Models;

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
}
