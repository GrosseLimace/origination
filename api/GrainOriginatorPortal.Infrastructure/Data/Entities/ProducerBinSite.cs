using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// A user-entered on-farm bin site for a producer: an optional name ("Anderson Site") and a
/// latitude/longitude pair, shown under the address as a Google Maps link. At most
/// <see cref="BinSiteRules.MaxPerCustomer"/> per producer. Replaced as a set on upsert (mirrors
/// the ProducerContact child-table pattern).
/// </summary>
public class ProducerBinSite
{
    public int Id { get; set; }
    public long CustomerId { get; set; }
    public string? Name { get; set; }
    /// <summary>decimal(9,6) — six places is ~0.1 m, the precision the card asks for.</summary>
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
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
    public const int MaxPerCustomer = 3;
    public const int NameMaxLength = 100;
    public const int DecimalPlaces = 6;
    public const double MinLatitude = 7.0;
    public const double MaxLatitude = 84.0;
    public const double MinLongitude = -180.0;
    public const double MaxLongitude = -52.0;
}
