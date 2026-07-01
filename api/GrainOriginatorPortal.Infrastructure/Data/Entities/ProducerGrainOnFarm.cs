using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Per-commodity-group "grain on farm" for a producer: how many bushels of a crop group (e.g. Corn,
/// Wheat, Soybeans) are currently on the farm and the target the farmer wants on hand. One row per
/// (customer, commodity group). The group is the Commodity.Category the rest of the app groups crops by.
/// Replaced as a set on upsert (mirrors the CustomerCommodity child-table pattern).
/// </summary>
public class ProducerGrainOnFarm
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string CommodityGroup { get; set; } = string.Empty;
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
    public string CommodityGroup { get; set; } = string.Empty;
    public decimal? BushelsOnHand { get; set; }
    public decimal? TargetBushels { get; set; }
    public string? Grade { get; set; }
}
