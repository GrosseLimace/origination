using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user-entered on-farm bin site for a producer: an optional name and a latitude/longitude
/// pair, shown under the address as a Google Maps link. A producer can have as many as they need
/// (only a sanity ceiling, <see cref="BinSiteRules.MaxPerCustomer"/>). Replaced as a set on upsert
/// (mirrors the ProducerContact child-table pattern), so <see cref="Id"/> changes on every save;
/// <see cref="SiteKey"/> is the identity that survives, and what grain-on-farm rows link through.
/// </summary>
public class ProducerBinSite
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    /// <summary>Stable identity across saves (the client generates it for a new site). Grain on Farm
    /// rows name their site by this key in the API; the database link is ProducerGrainOnFarm.BinSiteId.</summary>
    public Guid SiteKey { get; set; }
    public string? Name { get; set; }
    /// <summary>Optional (only the Name is required, user 2026-10-09); when present, both are set and
    /// stored as decimal(18,15) — a full Google Maps paste exactly as entered. The profile shortens
    /// them to six places; a site without them shows as plain text with no map link.</summary>
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    /// <summary>Storage capacity in bushels, optional — the only place capacity is recorded since the
    /// producer-level ProducerDetails.BinCapacity was dropped (2026-10-09; its values became "Bin 1" sites).</summary>
    public decimal? Capacity { get; set; }
    /// <summary>Display order within the producer.</summary>
    public int SortOrder { get; set; }

    [JsonIgnore]
    public Customer? Customer { get; set; }
}

/// <summary>Composed/flattened bin-site row carried on <see cref="ProducerDetails.BinSites"/> (read)
/// and passed to the repository upsert (write). Not an EF entity.</summary>
public class ProducerBinSiteEntry
{
    public Guid SiteKey { get; set; }
    public string? Name { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public decimal? Capacity { get; set; }
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
    /// <summary>The ceiling the dropped producer-level Bin Capacity had, so every moved value fits.</summary>
    public const double MaxCapacity = 100_000_000;
}
