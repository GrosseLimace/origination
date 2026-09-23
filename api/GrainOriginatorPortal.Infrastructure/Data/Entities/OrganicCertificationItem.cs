using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One certified item (a crop or handled product) within an operation's certification.
///
/// ItemName is the crop in the certifier's own plain English — "Corn", "Cleaned and bagged
/// grain" — which is why there is deliberately no foreign key to dbo.Commodities. A name that
/// does not map to a Scoular commodity is a vocabulary mismatch, not bad data, and must neither
/// be rejected on the way in nor hidden on the way out: display the raw certifier name when
/// unmapped. (This is where we diverge from BarchartCommodityMap's behaviour, which hides
/// unmapped symbols because a wrong bid is worse than no bid. An incomplete list of crops a
/// producer is certified for is worse than an unfamiliar crop name.)
///
/// A surrendered operation arrives with an empty item collection; that is expected, and the
/// business archives certification documents separately, so no history is kept here.
///
/// Replaced as a set on ingest, keyed on (certification, item id).
/// </summary>
public class OrganicCertificationItem
{
    public int Id { get; set; }
    public int OrganicCertificationId { get; set; }

    /// <summary>The certifier's item identifier. Unique within the operation, and the upsert key.</summary>
    public string ItemId { get; set; } = string.Empty;

    /// <summary>Which scope this item falls under — CROPS, HANDLING, and so on.</summary>
    public string? Scope { get; set; }

    public string? CertificateNumber { get; set; }
    public string? Status { get; set; }
    public DateTime? StatusEffectiveDate { get; set; }

    /// <summary>The crop or product, in the certifier's wording. Displayed as-is when it does not
    /// map to a Scoular commodity.</summary>
    public string? ItemName { get; set; }

    public string? CategoryName { get; set; }
    public string? CategoryId { get; set; }
    public string? ItemVarieties { get; set; }
    public string? OtherItems { get; set; }

    /// <summary>The three NOP labelling tiers, which are not mutually exclusive.</summary>
    public bool Organic { get; set; }
    public bool Organic100 { get; set; }
    public bool MadeWithOrganic { get; set; }

    public DateTime UpdatedOn { get; set; }

    [JsonIgnore]
    public OrganicCertification? OrganicCertification { get; set; }
}
