using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user-entered on-farm bin site for a producer: an optional name and a latitude/longitude
/// pair, shown under the address as a Google Maps link. A producer can have as many as they need
/// (only a sanity ceiling, <see cref="BinSiteRules.MaxPerCustomer"/>). Replaced as a set on upsert
/// (mirrors the ProducerContact child-table pattern).
/// </summary>
public class ProducerBinSite
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string? Name { get; set; }
    /// <summary>decimal(18,15) — keeps a full Google Maps paste (up to ~15 places) exactly as
    /// entered. The profile shortens it to six places for display; the map link uses all of it.</summary>
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    /// <summary>Storage capacity in bushels, optional. Independent of ProducerDetails.BinCapacity —
    /// the sites are NOT summed into it (user decision 2026-10-08, deferred).</summary>
    public decimal? Capacity { get; set; }
    /// <summary>Commodity code ("YC") from the Grain on Farm list, optional. Picking one the producer
    /// doesn't list adds it to their Commodities in the Edit dialog (client side).</summary>
    public string? CommodityCode { get; set; }
    /// <summary>Bushels at this site already marketed (sold/contracted), typed by hand, optional.
    /// Marketed + Unmarketed above Capacity is warned about in the dialog, never rejected.</summary>
    public decimal? Marketed { get; set; }
    /// <summary>Bushels at this site not yet marketed, typed by hand, optional.</summary>
    public decimal? Unmarketed { get; set; }
    /// <summary>Display order within the producer.</summary>
    public int SortOrder { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}

/// <summary>Composed/flattened bin-site row carried on <see cref="ProducerDetails.BinSites"/> (read)
/// and passed to the repository upsert (write). Not an EF entity.</summary>
public class ProducerBinSiteEntry
{
    public string? Name { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public decimal? Capacity { get; set; }
    public string? CommodityCode { get; set; }
    public decimal? Marketed { get; set; }
    public decimal? Unmarketed { get; set; }
    public int SortOrder { get; set; }
}

/// <summary>
/// North American coordinate rules for bin sites. Latitude must be north (positive) and longitude
/// west (negative), which also catches the two common entry mistakes — swapped values and a
/// dropped minus sign. The box runs from Panama (~7°N) to the Canadian Arctic (~84°N) and from
/// the end of the Aleutians (-180°) to Newfoundland (~-52°). Mirrored by
/// client/src/app/shared/utils/coordinates.ts — keep the two in step.
/// </summary>
public static class BinSiteRules
{
    /// <summary>Not a product limit — users add as many as they need. A sanity ceiling so one
    /// request can't write an unbounded number of rows.</summary>
    public const int MaxPerCustomer = 100;
    public const int NameMaxLength = 100;
    /// <summary>Scale of the decimal(18,15) columns. Users never round by hand; anything finer than
    /// this (beyond double precision anyway) is rounded on save so it fits the column.</summary>
    public const int StoredDecimalPlaces = 15;
    public const double MinLatitude = 7.0;
    public const double MaxLatitude = 84.0;
    public const double MinLongitude = -180.0;
    public const double MaxLongitude = -52.0;
    /// <summary>Same ceiling as the producer-level Bin Capacity field (UpsertProducerDetailsRequest).</summary>
    public const double MaxCapacity = 100_000_000;
    /// <summary>Same as ProducerGrainOnFarm.CommodityCode.</summary>
    public const int CommodityCodeMaxLength = 100;
}
