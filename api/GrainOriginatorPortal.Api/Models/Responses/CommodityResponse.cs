namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a commodity reference row. Entity-shaped (Decision 1).</summary>
public record CommodityResponse
{
    public int Id { get; init; }
    public string Code { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Category { get; init; }
    public string? Tier1 { get; init; }
    public string? Tier2 { get; init; }
    public string? Tier3 { get; init; }
    public string? BaseUOM { get; init; }
    public bool IsActive { get; init; } = true;
    public bool ShowInPlantingIntentions { get; init; }

    /// <summary>Null (the default) means every user sees this commodity. A value restricts it to
    /// callers whose current trade-unit selection includes a matching trade group &mdash; see
    /// Commodity.TradeGroupScope. The client does the filtering; this endpoint stays cacheable.</summary>
    public string? TradeGroupScope { get; init; }

    /// <summary>Comma-separated trade unit codes this commodity is restricted to, or null for no
    /// unit restriction. Matched by EXACT membership client-side, never as a substring &mdash; see
    /// Commodity.TradeUnitScope. OR-combined with TradeGroupScope.</summary>
    public string? TradeUnitScope { get; init; }

    /// <summary>Crop label the planting-intention surfaces group this commodity under, or null to use
    /// Category. Set for the organics ("Organic Soybeans" for YSBO) &mdash; see Commodity.PlantingCategory.
    /// Resolved client-side by plantingCategory() in shared/utils/planting-category.ts.</summary>
    public string? PlantingCategory { get; init; }
}
