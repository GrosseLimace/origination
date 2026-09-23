using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Per-commodity "grain on farm" for a producer: how many bushels of one commodity (e.g. YC, HRWW,
/// YSBO) are currently on the farm, a grade note, and the $/bu target. One row per (customer,
/// commodity code). Replaced as a set on upsert (mirrors the CustomerCommodity child-table pattern).
///
/// Keyed by CODE, the same values the producer's Commodities chips hold, so HRWW and SRWW are two
/// rows rather than one "Wheat". Before 2026-09-23 the column held a crop GROUP ("Corn", "Wheat");
/// the RenameGrainOnFarmGroupToCommodityCode migration renamed it without rewriting data, because a
/// group cannot be mapped to one code without guessing. Readers must therefore accept either a code
/// or a legacy group name — the client's crop matcher resolves both.
/// </summary>
public class ProducerGrainOnFarm
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    /// <summary>Commodity code (Commodity.Code), or a legacy crop-group name on rows saved before codes.</summary>
    public string CommodityCode { get; set; } = string.Empty;
    public decimal? BushelsOnHand { get; set; }
    public decimal? TargetBushels { get; set; }
    /// <summary>Free-text grade / quality note (e.g. "4.4%", "TW 58"). Not necessarily numeric.</summary>
    public string? Grade { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}

/// <summary>Composed/flattened grain-on-farm row carried on <see cref="ProducerDetails.GrainOnFarm"/>
/// (read) and passed to the repository upsert (write). Not an EF entity.</summary>
public class GrainOnFarmEntry
{
    public string CommodityCode { get; set; } = string.Empty;
    public decimal? BushelsOnHand { get; set; }
    public decimal? TargetBushels { get; set; }
    public string? Grade { get; set; }
}
