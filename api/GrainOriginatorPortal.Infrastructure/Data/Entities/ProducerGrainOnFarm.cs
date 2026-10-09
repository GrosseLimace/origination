using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// Per-commodity "grain on farm" for a producer: how many bushels of one commodity (e.g. YC, HRWW,
/// YSBO) are currently on the farm (total), how many of those are already sold, a grade note, and
/// the $/bu target. One row per (customer, bin site, commodity code): since 2026-10-09 each row belongs
/// to one of the producer's bin sites (<see cref="BinSiteId"/>); rows saved before then have no site.
/// Replaced as a set on upsert (mirrors the CustomerCommodity child-table pattern).
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
    /// <summary>The bin site this grain is stored at. NULL on rows saved before sites were linked
    /// (2026-10-09); the Edit dialog only adds new rows under a site.</summary>
    public int? BinSiteId { get; set; }
    /// <summary>Commodity code (Commodity.Code), or a legacy crop-group name on rows saved before codes.</summary>
    public string CommodityCode { get; set; } = string.Empty;
    /// <summary>Total bushels on the farm, sold or not.</summary>
    public decimal? BushelsOnHand { get; set; }
    /// <summary>Of <see cref="BushelsOnHand"/>, how many are already sold. User-entered.</summary>
    public decimal? BushelsSold { get; set; }
    /// <summary>The $/bu target PRICE — not bushels, despite the name. May be negative (basis).</summary>
    public decimal? TargetBushels { get; set; }
    /// <summary>Last bid for this commodity, user-entered. May be negative (basis). 4 decimals.</summary>
    public decimal? LastBid { get; set; }
    /// <summary>Free-text grade / quality note (e.g. "4.4%", "TW 58"). Not necessarily numeric.</summary>
    public string? Grade { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
    [JsonIgnore]
    public ProducerBinSite? BinSite { get; set; }
}

/// <summary>Composed/flattened grain-on-farm row carried on <see cref="ProducerDetails.GrainOnFarm"/>
/// (read) and passed to the repository upsert (write). Not an EF entity.</summary>
public class GrainOnFarmEntry
{
    /// <summary>The site's <see cref="ProducerBinSite.SiteKey"/>, or null when not tied to a site.</summary>
    public Guid? BinSiteKey { get; set; }
    /// <summary>Read only: the site's name, for display. Ignored on write.</summary>
    public string? BinSiteName { get; set; }
    public string CommodityCode { get; set; } = string.Empty;
    public decimal? BushelsOnHand { get; set; }
    public decimal? BushelsSold { get; set; }
    public decimal? TargetBushels { get; set; }
    public decimal? LastBid { get; set; }
    public string? Grade { get; set; }
}
