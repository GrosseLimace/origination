using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Infrastructure.Data.Entities;

/// <summary>
/// One certified item (a crop or handled product) within an operation's certification.
///
/// ── Two shapes, both normal (confirmed against captured samples, 2026-09-29) ──
/// <list type="bullet">
/// <item><b>Catalogued</b> — <see cref="ItemId"/>, <see cref="ItemName"/>, <see cref="CategoryId"/>
/// and <see cref="CategoryName"/> come from USDA's item catalogue; <see cref="OtherItems"/> is
/// null. e.g. 377 / "Sugercane" / 2 / "Field/Forageable".</item>
/// <item><b>Free text</b> — all four null, with the content in <see cref="OtherItems"/>. e.g.
/// "Alfalfa, Corn, CRP, Oats/Alfalfa, Pasture, Rye/Sorghum, Soybeans, Wheat/Alfalfa".</item>
/// </list>
///
/// Entire operations arrive free-text — one captured sample has no catalogued items whatsoever. So
/// <see cref="ItemId"/> is nullable and is NOT a key. An earlier version made it a required string
/// and keyed a unique index on it, which would have rejected every crop that producer holds and
/// stored a certified operation with nothing certified against it.
///
/// **Anything rendering crops must read ItemName OR OtherItems**, not ItemName alone.
///
/// There is deliberately no foreign key to dbo.Commodities. A name that does not map to a Scoular
/// commodity is a vocabulary mismatch, not bad data, and must neither be rejected on the way in nor
/// hidden on the way out. (This is where we diverge from BarchartCommodityMap, which hides unmapped
/// symbols because a wrong bid is worse than no bid. An incomplete list of the crops a producer is
/// certified for is worse than an unfamiliar crop name.)
///
/// A surrendered operation arrives with an empty item collection; that is expected, and the
/// business archives certification documents separately, so no history is kept here.
///
/// Replaced as a set on every ingest. There is no natural key — see the DbContext configuration.
/// </summary>
public class OrganicCertificationItem
{
    public int Id { get; set; }
    public int OrganicCertificationId { get; set; }

    /// <summary>USDA catalogue item id. Null on free-text items, so not usable as a key.</summary>
    public int? ItemId { get; set; }

    /// <summary>Which scope this item falls under — "Crops", "Handling", and so on.</summary>
    public string? Scope { get; set; }

    public string? CertificateNumber { get; set; }
    public string? Status { get; set; }
    public DateTime? StatusEffectiveDate { get; set; }

    /// <summary>The crop or product from USDA's catalogue. Null on free-text items — read
    /// <see cref="OtherItems"/> in that case.</summary>
    public string? ItemName { get; set; }

    public string? CategoryName { get; set; }

    /// <summary>USDA catalogue category id. Null on free-text items.</summary>
    public int? CategoryId { get; set; }

    public string? Varieties { get; set; }

    /// <summary>Free-text contents where the certifier did not use the catalogue. NOT reliably a
    /// comma-separated list: one captured sample reads "Carryover Crops of: 2024 Soybeans - 4000
    /// bushels and 2024 Corn - 5000 bushels". Splitting it would mangle that, and would also break
    /// entries like "Oats/Alfalfa" that legitimately contain punctuation.</summary>
    public string? OtherItems { get; set; }

    /// <summary>The NOP labelling tiers. Tri-state in the source (true or null); stored as false
    /// when absent. The captured samples use the two exclusively of each other.</summary>
    public bool Organic { get; set; }
    public bool Organic100 { get; set; }

    public DateTime UpdatedOn { get; set; }

    [JsonIgnore]
    public OrganicCertification? OrganicCertification { get; set; }
}
